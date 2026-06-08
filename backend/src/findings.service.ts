import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from './prisma.service';

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
      this.prisma.finding.count({ where: { ...base, status: 'OPEN', seenCount: 1, createdAt: { gte: oneWeekAgo } } }),
      this.prisma.finding.count({ where: { ...base, status: 'OPEN', seenCount: { gt: 1 } } }),
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
}
