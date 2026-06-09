import { Injectable, NotFoundException, InternalServerErrorException, ConflictException, OnModuleInit, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from './prisma.service';

const CRON_TO_INTERVAL: Record<string, number> = {
  '0 2 * * *':   1,   // diario
  '0 2 * * 1':   7,   // semanal (lunes)
  '0 2 * * 0':   7,   // semanal (domingo)
  '0 2 1 * *':   30,  // mensual
  '0 2 1,15 * *': 15, // quincenal
};

function computeNextScan(cronExpr: string): Date {
  const days = CRON_TO_INTERVAL[cronExpr] ?? 7;
  const next = new Date();
  next.setDate(next.getDate() + days);
  next.setHours(2, 0, 0, 0);
  return next;
}

@Injectable()
export class DomainsService implements OnModuleInit {
  private readonly logger = new Logger(DomainsService.name);
  constructor(private readonly prisma: PrismaService) {}

  /** Al arrancar, marca como FAILED los scan jobs atascados (>5 min en RUNNING/PENDING).
   *  Esto evita que reinicios del contenedor bloqueen nuevos scans indefinidamente. */
  async onModuleInit() {
    const staleThreshold = new Date(Date.now() - 5 * 60 * 1000); // 5 minutos
    const result = await this.prisma.scanJob.updateMany({
      where: { status: { in: ['RUNNING', 'PENDING'] }, startedAt: { lt: staleThreshold } },
      data: { status: 'FAILED' },
    });
    if (result.count > 0)
      this.logger.warn(`Startup cleanup: ${result.count} scan job(s) atascado(s) → FAILED`);
  }

  /** Limpia TODOS los scan jobs RUNNING/PENDING → FAILED. Uso: emergencia desde UI. */
  async clearStaleScans(): Promise<{ cleared: number }> {
    const result = await this.prisma.scanJob.updateMany({
      where: { status: { in: ['RUNNING', 'PENDING'] } },
      data: { status: 'FAILED' },
    });
    this.logger.warn(`clearStaleScans: ${result.count} job(s) limpiado(s) manualmente`);
    return { cleared: result.count };
  }

  list(orgId = 'org_demo') {
    return this.prisma.monitoredDomain.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
    });
  }

  create(data: { domain: string; tools?: string[]; cronExpr?: string; scanProfile?: string }, orgId = 'org_demo') {
    const cronExpr = data.cronExpr ?? '0 2 * * 1';
    return this.prisma.monitoredDomain.create({
      data: {
        domain: data.domain.toLowerCase().trim(),
        orgId,
        tools: data.tools ?? ['nmap', 'nuclei'],
        cronExpr,
        scanProfile: data.scanProfile ?? 'standard',
        nextScan: computeNextScan(cronExpr),
      },
    });
  }

  async update(id: string, data: Partial<{ tools: string[]; cronExpr: string; enabled: boolean; scanProfile: string }>) {
    const existing = await this.prisma.monitoredDomain.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Domain ${id} not found`);
    const cronExpr = data.cronExpr ?? existing.cronExpr;
    return this.prisma.monitoredDomain.update({
      where: { id },
      data: {
        ...data,
        ...(data.cronExpr ? { nextScan: computeNextScan(cronExpr) } : {}),
      },
    });
  }

  async remove(id: string) {
    await this.prisma.monitoredDomain.findUniqueOrThrow({ where: { id } });
    return this.prisma.monitoredDomain.delete({ where: { id } });
  }

  pendingScans() {
    return this.prisma.monitoredDomain.findMany({
      where: {
        enabled: true,
        OR: [{ nextScan: null }, { nextScan: { lte: new Date() } }],
      },
      orderBy: { nextScan: 'asc' },
    });
  }

  async markScanned(id: string) {
    const domain = await this.prisma.monitoredDomain.findUniqueOrThrow({ where: { id } });
    return this.prisma.monitoredDomain.update({
      where: { id },
      data: {
        lastScanned: new Date(),
        nextScan: computeNextScan(domain.cronExpr),
      },
    });
  }

  /** Número máximo de scans RUNNING/PENDING simultáneos permitidos. */
  private get MAX_CONCURRENT_SCANS(): number {
    return parseInt(process.env.MAX_CONCURRENT_SCANS ?? '3', 10) || 3;
  }

  async triggerScan(domainId: string): Promise<{ scanId: string; status: string; domain: string }> {
    const domain = await this.prisma.monitoredDomain.findUnique({ where: { id: domainId } });
    if (!domain) throw new NotFoundException(`Domain ${domainId} not found`);

    // Rechazar si ya hay demasiados scans activos para evitar saturar el collector
    const activeScans = await this.prisma.scanJob.count({
      where: { orgId: 'org_demo', status: { in: ['RUNNING', 'PENDING'] } },
    });
    if (activeScans >= this.MAX_CONCURRENT_SCANS) {
      throw new ConflictException(
        `Límite de scans concurrentes alcanzado (${activeScans}/${this.MAX_CONCURRENT_SCANS}). ` +
        `Espera a que termine un scan activo antes de iniciar otro.`,
      );
    }

    // Cooldown: evitar re-scan del mismo dominio en menos de SCAN_COOLDOWN_SECONDS
    const COOLDOWN_MS = (parseInt(process.env.SCAN_COOLDOWN_SECONDS ?? '60', 10) || 60) * 1000;
    const recentScan = await this.prisma.scanJob.findFirst({
      where: {
        orgId: 'org_demo',
        domain: domain.domain,
        startedAt: { gte: new Date(Date.now() - COOLDOWN_MS) },
        status: { not: 'CANCELLED' },
      },
      orderBy: { startedAt: 'desc' },
    });
    if (recentScan) {
      const elapsedMs = Date.now() - recentScan.startedAt.getTime();
      const remainingMs = Math.max(0, COOLDOWN_MS - elapsedMs);
      const elapsed = Math.round(elapsedMs / 1000);
      const remaining = Math.ceil(remainingMs / 1000);
      throw new ConflictException({
        error: 'COOLDOWN',
        remainingMs,
        elapsedMs,
        domain: domain.domain,
        message: `El dominio ${domain.domain} fue escaneado hace ${elapsed}s. Espera ${remaining}s más antes de lanzar otro scan.`,
      });
    }

    const scanId = randomUUID();
    const collectorUrl = process.env.COLLECTOR_URL ?? 'http://collector:5000';
    const apiInternalUrl = process.env.API_INTERNAL_URL ?? 'http://host.docker.internal:3001';

    // Only send an explicit tool list when the domain has been customized.
    // When tools match the profile defaults, omit `plugins` so the collector
    // uses the full `habilitado` map from config.yml — this prevents a
    // quick-profile tool list from overriding a standard/deep scan.
    const PROFILE_DEFAULT_TOOLS: Record<string, string[]> = {
      quick:    ['nmap', 'nuclei', 'whatweb', 'gobuster'],
      standard: ['nmap', 'nuclei', 'nikto', 'whatweb', 'gobuster', 'sslscan',
                 'subfinder', 'httpx', 'testssl', 'katana', 'trufflehog'],
      deep:     ['nmap', 'nuclei', 'nikto', 'whatweb', 'gobuster', 'sslscan', 'ffuf',
                 'subfinder', 'httpx', 'testssl', 'katana', 'trufflehog',
                 'dalfox', 'sqlmap', 'amass'],
    };
    const scanProfile = (domain as any).scanProfile ?? 'standard';
    const profileDefaults = PROFILE_DEFAULT_TOOLS[scanProfile] ?? PROFILE_DEFAULT_TOOLS['standard'];
    const storedTools = [...(domain.tools ?? [])].sort();
    const isCustomized = JSON.stringify(storedTools) !== JSON.stringify([...profileDefaults].sort());
    const effectiveTools = isCustomized ? domain.tools : profileDefaults;

    // Crear ScanJob ANTES de llamar al collector para evitar race condition
    // (el collector puede enviar findings antes de que el ScanJob exista en DB)
    await this.prisma.scanJob.create({
      data: {
        scanId,
        orgId: 'org_demo',
        domain: domain.domain,
        collectorId: domain.domain,
        tools: effectiveTools,
        status: 'RUNNING',
      },
    }).catch(() => { /* no detener el scan si el registro falla */ });

    try {
      const response = await fetch(`${collectorUrl}/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target: domain.domain,
          ...(isCustomized ? { plugins: domain.tools } : {}),
          scan_id: scanId,
          api_url: apiInternalUrl,
          profile: scanProfile,
        }),
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Collector responded ${response.status}: ${text}`);
      }
    } catch (err: any) {
      const isConnErr = err.cause?.code === 'ECONNREFUSED' || err.name === 'TimeoutError' || err.message?.includes('ECONNREFUSED');
      const hint = isConnErr
        ? `Collector no disponible en ${collectorUrl}. En desarrollo local arranca el collector con Docker: docker compose up -d collector`
        : err.message;
      throw new InternalServerErrorException(`Collector error: ${hint}`);
    }

    // Marcar último scan en el dominio
    await this.prisma.monitoredDomain.update({
      where: { id: domainId },
      data: { lastScanned: new Date(), nextScan: computeNextScan(domain.cronExpr) },
    });

    return { scanId, status: 'started', domain: domain.domain };
  }

  async configPreview(id: string) {
    const domain = await this.prisma.monitoredDomain.findUnique({ where: { id } });
    if (!domain) throw new NotFoundException(`Domain ${id} not found`);

    const PROFILES: Record<string, { descripcion: string; duracion: string; defaultTools: string[] }> = {
      quick:    { descripcion: 'Reconocimiento rápido',              duracion: '2–5 min',     defaultTools: ['nmap', 'nuclei', 'whatweb', 'gobuster'] },
      standard: { descripcion: 'Balance cobertura/ruido (Recomendado)', duracion: '10–20 min',  defaultTools: ['nmap', 'nuclei', 'nikto', 'whatweb', 'gobuster', 'sslscan'] },
      deep:     { descripcion: 'Auditoría profunda / Red Team',       duracion: '30–120 min', defaultTools: ['nmap', 'nuclei', 'nikto', 'whatweb', 'gobuster', 'sslscan', 'ffuf'] },
    };

    const profile = (domain as any).scanProfile ?? 'standard';
    const meta = PROFILES[profile] ?? PROFILES['standard'];
    const effectiveTools = domain.tools;
    const defaultTools  = meta.defaultTools;

    return {
      domain: domain.domain,
      profile,
      descripcion: meta.descripcion,
      duracion: meta.duracion,
      toolsEffective: effectiveTools,
      toolsDefault: defaultTools,
      customized: JSON.stringify([...effectiveTools].sort()) !== JSON.stringify([...defaultTools].sort()),
    };
  }
}
