import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from './prisma.service';
import { TelemetryService } from './telemetry.service';

// Severidades en orden de criticidad para ordenar resultados
const SEV_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telemetry: TelemetryService,
  ) {}

  // ─── Genera (o regenera) el informe de un scan completo ──────────────────────
  async generateScanReport(scanId: string, force = false): Promise<any> {
    // Si ya existe y no se pide regenerar, devolver el existente
    const existing = await this.prisma.scanReport.findUnique({ where: { scanId } });
    if (existing && !force) {
      return this.enrichReportWithFindings(existing);
    }

    // Obtener metadatos del scan
    const job = await this.prisma.scanJob.findUnique({ where: { scanId } });
    if (!job) {
      this.logger.warn(`generateScanReport: scanId=${scanId} sin ScanJob — verificar si el scan fue iniciado desde UI`);
      return null;
    }

    const { domain, orgId, collectorId, tools } = job;

    // Obtener activo asociado al dominio
    const asset = await this.prisma.asset.findFirst({
      where: { organizationId: orgId, OR: [{ domain }, { ip: domain }] },
    });

    const durationSec = job.completedAt
      ? Math.round((job.completedAt.getTime() - job.startedAt.getTime()) / 1000)
      : null;

    if (!asset) {
      // El scan terminó pero no hay hallazgos (dominio nuevo o herramientas sin resultados)
      const report = await this.upsertReport({
        scanId, orgId, domain, collectorId, tools,
        newFindings: 0, recurringFindings: 0, staleFindings: 0, totalOpen: 0,
        bySeverity: {}, newBySeverity: {}, riskScore: 0,
        prevScanId: null, riskScoreDelta: 0, durationSec,
      });
      return report;
    }

    // ─── Todos los hallazgos OPEN/IN_PROGRESS del activo ─────────────────────
    const allOpenFindings = await this.prisma.finding.findMany({
      where: { assetId: asset.id, status: { in: ['OPEN', 'IN_PROGRESS'] } },
      orderBy: [{ severity: 'asc' }, { createdAt: 'desc' }],
    });

    // ─── Clasificación de hallazgos ───────────────────────────────────────────
    // Confirmados en ESTE scan
    const thisScanFindings = allOpenFindings.filter(f => f.scanId === scanId);
    // No vistos en este scan (puede que estén resueltos, o la tool los omitió)
    const staleFindings = allOpenFindings.filter(f => f.scanId !== scanId);
    // Nuevo: primera vez detectado en este scan
    const newFindings = thisScanFindings.filter(f => f.firstScanId === scanId);
    // Recurrente: ya conocido, reconfirmado en este scan
    const recurringFindings = thisScanFindings.filter(f => f.firstScanId !== scanId);

    // Distribución por severidad
    const bySev = (arr: Array<{ severity: string }>) =>
      arr.reduce((acc, f) => {
        acc[f.severity] = (acc[f.severity] ?? 0) + 1;
        return acc;
      }, {} as Record<string, number>);

    const riskScore = asset.exposureScore;

    // Scan anterior para calcular delta
    const prevReport = await this.prisma.scanReport.findFirst({
      where: { domain, orgId, NOT: { scanId } },
      orderBy: { createdAt: 'desc' },
    });
    const riskScoreDelta = prevReport ? riskScore - prevReport.riskScore : 0;

    const report = await this.upsertReport({
      scanId, orgId, domain, collectorId, tools,
      newFindings: newFindings.length,
      recurringFindings: recurringFindings.length,
      staleFindings: staleFindings.length,
      totalOpen: allOpenFindings.length,
      bySeverity: bySev(allOpenFindings),
      newBySeverity: bySev(newFindings),
      riskScore,
      prevScanId: prevReport?.scanId ?? null,
      riskScoreDelta,
      durationSec,
    });

    // Asegurar que el ScanJob quede DONE
    if (job.status !== 'DONE') {
      await this.prisma.scanJob.update({
        where: { scanId },
        data: { status: 'DONE', completedAt: job.completedAt ?? new Date() },
      });
    }

    // Broadcast para que el frontend pueda reaccionar
    await this.telemetry.publish({
      id: randomUUID(),
      type: 'scan:report_ready',
      source: 'ReportsService',
      payload: {
        organizationId: orgId, scanId, domain,
        newFindings: newFindings.length,
        totalOpen: allOpenFindings.length,
        riskScore, riskScoreDelta,
      },
      timestamp: new Date(),
    });

    this.logger.log(
      `Informe generado para scanId=${scanId} domain=${domain}: ` +
      `nuevos=${newFindings.length} recurrentes=${recurringFindings.length} sin confirmar=${staleFindings.length}`,
    );

    return {
      ...report,
      newFindingsList:       newFindings,
      recurringFindingsList: recurringFindings,
      staleFindingsList:     staleFindings,
    };
  }

  // ─── Lista los informes de una organización ───────────────────────────────────
  async listReports(orgId: string, domain?: string) {
    return this.prisma.scanReport.findMany({
      where: { orgId, ...(domain ? { domain } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  // ─── Obtiene un informe por scanId con hallazgos detallados ──────────────────
  async getReport(scanId: string) {
    const report = await this.prisma.scanReport.findUnique({ where: { scanId } });
    if (!report) return null;
    return this.enrichReportWithFindings(report);
  }

  // ─── Lista los ScanJobs de una org (para mostrar historial de scans) ──────────
  async listJobs(orgId: string) {
    return this.prisma.scanJob.findMany({
      where: { orgId },
      orderBy: { startedAt: 'desc' },
      take: 100,
    });
  }

  // ─── Privados ─────────────────────────────────────────────────────────────────
  private async upsertReport(data: {
    scanId: string; orgId: string; domain: string; collectorId: string; tools: string[];
    newFindings: number; recurringFindings: number; staleFindings: number; totalOpen: number;
    bySeverity: Record<string, number>; newBySeverity: Record<string, number>;
    riskScore: number; prevScanId: string | null; riskScoreDelta: number; durationSec: number | null;
  }) {
    return this.prisma.scanReport.upsert({
      where: { scanId: data.scanId },
      update: {
        newFindings: data.newFindings,
        recurringFindings: data.recurringFindings,
        staleFindings: data.staleFindings,
        totalOpen: data.totalOpen,
        bySeverity: data.bySeverity,
        newBySeverity: data.newBySeverity,
        riskScore: data.riskScore,
        prevScanId: data.prevScanId,
        riskScoreDelta: data.riskScoreDelta,
        durationSec: data.durationSec,
      },
      create: data,
    });
  }

  private async enrichReportWithFindings(report: any) {
    const asset = await this.prisma.asset.findFirst({
      where: { organizationId: report.orgId, OR: [{ domain: report.domain }, { ip: report.domain }] },
    });
    if (!asset) return report;

    const allOpen = await this.prisma.finding.findMany({
      where: { assetId: asset.id, status: { in: ['OPEN', 'IN_PROGRESS'] } },
      orderBy: [{ severity: 'asc' }, { createdAt: 'desc' }],
    });

    const thisScan   = allOpen.filter(f => f.scanId === report.scanId);
    const stale      = allOpen.filter(f => f.scanId !== report.scanId);
    const newF       = thisScan.filter(f => f.firstScanId === report.scanId);
    const recurring  = thisScan.filter(f => f.firstScanId !== report.scanId);

    return {
      ...report,
      newFindingsList:       this.sortBySeverity(newF),
      recurringFindingsList: this.sortBySeverity(recurring),
      staleFindingsList:     this.sortBySeverity(stale),
    };
  }

  private sortBySeverity<T extends { severity: string }>(arr: T[]): T[] {
    return [...arr].sort((a, b) => (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9));
  }

  // ─── Obtiene metadatos del ScanJob (para usar en el trigger manual) ─────────
  async getJobMeta(scanId: string) {
    return this.prisma.scanJob.findUnique({ where: { scanId } });
  }

  // ─── Obtiene el informe ejecutivo de IA de un scan ────────────────────────────
  async getAiReport(scanId: string) {
    return this.prisma.aiScanReport.findUnique({ where: { scanId } });
  }

  // ─── Lista informes ejecutivos de IA de una organización ─────────────────────
  async listAiReports(orgId: string) {
    return this.prisma.aiScanReport.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}
