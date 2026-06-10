import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from './prisma.service';
import { parse as csvParse } from 'csv-parse/sync';
import { readFileSync } from 'fs';
import { join } from 'path';

@Injectable()
export class FindingsService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('findings-ingest') private readonly ingestQueue: Queue,
    @InjectQueue('findings-ai')     private readonly aiQueue: Queue,
  ) {}

  async ingest(dto: any) {
    const job = await this.ingestQueue.add('normalize', {
      ...dto,
      enqueuedAt: new Date().toISOString(),
    }, { attempts: 3, backoff: { type: 'exponential', delay: 2000 } });
    return { accepted: true, jobId: job.id };
  }

  async listByOrg(orgId: string, opts: { severity?: string; includeAll?: boolean; from?: string; to?: string } = {}) {
    const where: any = { asset: { organizationId: orgId }, archivedAt: null };
    if (!opts.includeAll) where.status = 'OPEN';
    if (opts.severity)   where.severity = opts.severity;
    if (opts.from || opts.to) {
      where.createdAt = {};
      if (opts.from) where.createdAt.gte = new Date(opts.from);
      if (opts.to)   where.createdAt.lte = new Date(opts.to + 'T23:59:59Z');
    }
    const [data, total] = await Promise.all([
      this.prisma.finding.findMany({
        where, take: 200, orderBy: { createdAt: 'desc' },
        include: { asset: { select: { domain: true, ip: true } } },
      }),
      this.prisma.finding.count({ where }),
    ]);
    return { data, total, page: 1, limit: 200 };
  }

  async stats(orgId: string) {
    const base: any = { asset: { organizationId: orgId } };
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [total, open, critical, high, newThisWeek, recurring] = await Promise.all([
      this.prisma.finding.count({ where: base }),
      this.prisma.finding.count({ where: { ...base, status: 'OPEN' } }),
      this.prisma.finding.count({ where: { ...base, severity: 'CRITICAL', status: 'OPEN' } }),
      this.prisma.finding.count({ where: { ...base, severity: 'HIGH',     status: 'OPEN' } }),
      this.prisma.finding.count({ where: { ...base, status: 'OPEN', seenCount: 1, recurrenceCount: 0, createdAt: { gte: oneWeekAgo } } }),
      // recurring = seen more than once in same lifecycle OR re-opened after being closed
      this.prisma.finding.count({ where: { ...base, status: 'OPEN', OR: [{ seenCount: { gt: 1 } }, { recurrenceCount: { gt: 0 } }] } }),
    ]);
    return { total, open, critical, high, newThisWeek, recurring };
  }

  async severityDistribution(orgId: string) {
    const rows = await this.prisma.finding.groupBy({
      by: ['severity'],
      where: { asset: { organizationId: orgId }, status: 'OPEN' },
      _count: { severity: true },
    });
    return rows.map(r => ({ severity: r.severity, count: r._count.severity }));
  }

  async updateTracking(id: string, data: {
    status?: string;
    startDate?: string;
    endDate?: string;
    responsible?: string;
    postAnalysisDate?: string;
    closingDate?: string;
    remediationEvidence?: string;
    closingNotes?: string;
  }) {
    return this.prisma.finding.update({
      where: { id },
      data: {
        remediationStatus:    data.status            ?? undefined,
        remediationStartDate: data.startDate         ? new Date(data.startDate)         : undefined,
        remediationEndDate:   data.endDate           ? new Date(data.endDate)           : undefined,
        responsible:          data.responsible       ?? undefined,
        postAnalysisDate:     data.postAnalysisDate  ? new Date(data.postAnalysisDate)  : undefined,
        closingDate:          data.closingDate       ? new Date(data.closingDate)       : undefined,
        remediationEvidence:  data.remediationEvidence ?? undefined,
        closingNotes:         data.closingNotes      ?? undefined,
      },
    });
  }

  async remediationHistory(orgId: string, opts: { from?: string; to?: string; archived?: boolean } = {}) {
    const where: any = {
      asset: { organizationId: orgId },
      remediationStatus: 'PROCESADO',
    };
    if (opts.archived === true)  where.archivedAt = { not: null };
    if (opts.archived === false) where.archivedAt = null;
    if (opts.from || opts.to) {
      where.closingDate = {};
      if (opts.from) where.closingDate.gte = new Date(opts.from);
      if (opts.to)   where.closingDate.lte = new Date(opts.to + 'T23:59:59Z');
    }
    return this.prisma.finding.findMany({
      where,
      include: {
        asset: { select: { domain: true, ip: true, assetType: true } },
        aiAnalysis: { select: { summary: true, riskLevel: true, businessImpact: true, remediationPlan: true } },
      },
      orderBy: { closingDate: 'desc' },
      take: 500,
    });
  }

  async remediationFindings(orgId: string, opts: { from?: string; to?: string } = {}) {
    const where: any = {
      asset: { organizationId: orgId },
      severity: { in: ['CRITICAL', 'HIGH'] },
      status: 'OPEN',
      archivedAt: null,
    };
    if (opts.from || opts.to) {
      where.createdAt = {};
      if (opts.from) where.createdAt.gte = new Date(opts.from);
      if (opts.to)   where.createdAt.lte = new Date(opts.to + 'T23:59:59Z');
    }
    return this.prisma.finding.findMany({
      where,
      include: {
        asset: { select: { domain: true, ip: true } },
        aiAnalysis: true,
      },
      orderBy: [{ createdAt: 'desc' }],
    }).then(findings =>
      findings.sort((a, b) => {
        const order: Record<string, number> = { CRITICAL: 0, HIGH: 1 };
        return (order[a.severity] ?? 2) - (order[b.severity] ?? 2);
      })
    );
  }

  async archiveOld(orgId: string, daysOld = 90) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysOld);
    const result = await this.prisma.finding.updateMany({
      where: {
        asset: { organizationId: orgId },
        remediationStatus: 'PROCESADO',
        closingDate: { lt: cutoff },
        archivedAt: null,
      },
      data: { archivedAt: new Date() },
    });
    return { archived: result.count, cutoff };
  }

  async findingsByAsset(orgId: string) {
    const assets = await this.prisma.asset.findMany({
      where: { organizationId: orgId },
      include: {
        findings: {
          where: { status: 'OPEN' },
          select: { id: true, severity: true, title: true, sourceTool: true, createdAt: true, category: true },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { exposureScore: 'desc' },
    });
    return assets.map(a => ({
      ...a,
      findingsBySeverity: {
        CRITICAL: a.findings.filter(f => f.severity === 'CRITICAL').length,
        HIGH:     a.findings.filter(f => f.severity === 'HIGH').length,
        MEDIUM:   a.findings.filter(f => f.severity === 'MEDIUM').length,
        LOW:      a.findings.filter(f => f.severity === 'LOW').length,
        INFO:     a.findings.filter(f => f.severity === 'INFO').length,
      },
    }));
  }

  async getAnalysis(findingId: string) {
    return this.prisma.aiAnalysis.findUnique({
      where: { findingId },
    });
  }

  async triggerAnalysis(findingId: string, provider?: 'gemini' | 'ollama') {
    const finding = await this.prisma.finding.findUnique({ where: { id: findingId } });
    if (!finding) throw new Error(`Finding ${findingId} not found`);
    const job = await this.aiQueue.add(
      'analyze',
      { findingId, ...(provider ? { provider } : {}) },
      { attempts: 2, backoff: { type: 'fixed', delay: 3000 }, removeOnComplete: 50 },
    );
    return { queued: true, jobId: job.id, findingId };
  }

  async reanalyzeBatch(findingIds: string[], provider?: 'gemini' | 'ollama') {
    const jobs = await Promise.all(
      findingIds.map(id =>
        this.aiQueue.add(
          'analyze',
          { findingId: id, ...(provider ? { provider } : {}) },
          { attempts: 2, backoff: { type: 'fixed', delay: 3000 }, removeOnComplete: 50 },
        ),
      ),
    );
    return { queued: jobs.length, findingIds };
  }

  // ─── Manual finding creation ──────────────────────────────────────────────
  async createManual(dto: {
    organizationId: string;
    assetTarget: string;       // IP or hostname
    source: string;            // PENTEST | COMPLIANCE | BUG_BOUNTY | INTERNAL | EXTERNAL_CLIENT
    category: string;
    severity: string;
    title: string;
    description?: string;
    cve?: string;
    cvss?: number;
    responsible?: string;
    remediationEndDate?: string;
  }) {
    // Upsert asset
    let asset = await this.prisma.asset.findFirst({
      where: {
        organizationId: dto.organizationId,
        OR: [{ domain: dto.assetTarget }, { ip: dto.assetTarget }],
      },
    });
    if (!asset) {
      const isIp = /^\d{1,3}(\.\d{1,3}){3}$|^[0-9a-fA-F:]+:[0-9a-fA-F:]+$/.test(dto.assetTarget);
      asset = await this.prisma.asset.create({
        data: {
          organizationId: dto.organizationId,
          assetType: isIp ? 'IP' : 'DOMAIN',
          ...(isIp ? { ip: dto.assetTarget } : { domain: dto.assetTarget }),
        },
      });
    }

    return this.prisma.finding.create({
      data: {
        assetId: asset.id,
        category: dto.category,
        severity: dto.severity.toUpperCase(),
        title: dto.title,
        description: dto.description,
        sourceTool: 'manual',
        cve: dto.cve,
        cvss: dto.cvss,
        source: dto.source,
        isManual: true,
        responsible: dto.responsible,
        remediationEndDate: dto.remediationEndDate ? new Date(dto.remediationEndDate) : undefined,
        status: 'OPEN',
      },
      include: { asset: { select: { domain: true, ip: true, assetType: true } } },
    });
  }

  // ─── CSV import ───────────────────────────────────────────────────────────
  async importFromCsv(filePath: string, orgId: string): Promise<{ imported: number; errors: { row: number; error: string }[] }> {
    const content = readFileSync(filePath, 'utf8');
    let rows: any[];
    try {
      rows = csvParse(content, { columns: true, skip_empty_lines: true, trim: true });
    } catch (e: any) {
      throw new BadRequestException(`CSV inválido: ${e.message}`);
    }

    let imported = 0;
    const errors: { row: number; error: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const required = ['asset', 'category', 'severity', 'title', 'source'];
        for (const field of required) {
          if (!row[field]) throw new Error(`Campo requerido: ${field}`);
        }
        await this.createManual({
          organizationId: orgId,
          assetTarget: row['asset'],
          source: (row['source'] || 'PENTEST').toUpperCase(),
          category: row['category'],
          severity: row['severity'],
          title: row['title'],
          description: row['description'],
          cve: row['cve'],
          cvss: row['cvss'] ? parseFloat(row['cvss']) : undefined,
          responsible: row['responsible'],
          remediationEndDate: row['remediation_end_date'],
        });
        imported++;
      } catch (e: any) {
        errors.push({ row: i + 2, error: e.message });
      }
    }

    return { imported, errors };
  }

  getCsvTemplate(): Buffer {
    const headers = ['asset', 'source', 'category', 'severity', 'title', 'description', 'cve', 'cvss', 'responsible', 'remediation_end_date'];
    const example = ['192.168.1.1', 'PENTEST', 'Autenticación', 'HIGH', 'Contraseña débil en panel admin', 'Panel /admin accesible sin MFA', 'CVE-2024-1234', '7.5', 'Equipo Infraestructura', '2025-12-31'];
    const sourceOptions = '# source válidos: SCAN | PENTEST | COMPLIANCE | BUG_BOUNTY | INTERNAL | EXTERNAL_CLIENT';
    const severityOptions = '# severity válidos: CRITICAL | HIGH | MEDIUM | LOW | INFO';
    const csv = [sourceOptions, severityOptions, headers.join(','), example.join(',')].join('\n');
    return Buffer.from(csv, 'utf8');
  }

  // ─── Evidence file attachment ─────────────────────────────────────────────
  async addEvidenceFile(findingId: string, filename: string, originalName: string): Promise<{ evidenceFiles: string[] }> {
    const finding = await this.prisma.finding.findUnique({ where: { id: findingId }, select: { evidenceFiles: true } });
    if (!finding) throw new NotFoundException(`Finding ${findingId} no encontrado`);

    const files = (Array.isArray(finding.evidenceFiles) ? finding.evidenceFiles : []) as string[];
    const fileUrl = `/uploads/evidence/${filename}`;
    files.push(fileUrl);

    await this.prisma.finding.update({ where: { id: findingId }, data: { evidenceFiles: files } });
    return { evidenceFiles: files };
  }
}

