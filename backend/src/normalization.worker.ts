import { Injectable, Logger } from '@nestjs/common';
import { Worker, Job, Queue } from 'bullmq';
import { createHash } from 'node:crypto';
import { PrismaService } from './prisma.service';
import { TelemetryService } from './telemetry.service';
import { AlertEngine } from './alert.engine';

@Injectable()
export class NormalizationWorker {
  private readonly logger = new Logger(NormalizationWorker.name);
  private worker: Worker;
  private readonly aiQueue = new Queue('findings-ai', {
    connection: { url: process.env.REDIS_URL || 'redis://redis:6379' },
  });

  constructor(
    private readonly prisma: PrismaService,
    private readonly telemetry: TelemetryService,
    private readonly alertEngine: AlertEngine,
  ) {}

  start() {
    this.worker = new Worker('findings-ingest', async (job: Job) => this.process(job), {
      connection: { url: process.env.REDIS_URL || 'redis://redis:6379' },
      concurrency: 5,
    });
    this.worker.on('failed', (j, err) => this.logger.error(`Job ${j?.id} failed: ${err.message}`));
    this.logger.log('NormalizationWorker started');
  }

  private async process(job: Job) {
    const data = job.data;
    this.logger.debug(`Normalizing job ${job.id} from ${data.sourceTool}`);

    // ─── Audit: raw ingest ───────────────────────────────────────────────────
    await this.prisma.auditLog.create({
      data: { type: 'INGEST_RAW', rawData: data },
    });

    // ─── Compute dedup hash ──────────────────────────────────────────────────
    const contentHash = createHash('sha256')
      .update([data.assetId ?? '', data.category ?? '', data.title ?? '', data.sourceTool ?? ''].join('|'))
      .digest('hex')
      .slice(0, 32);

    await this.prisma.organization.upsert({
      where: { id: 'org_demo' },
      update: {},
      create: { id: 'org_demo', name: 'Demo Organization' },
    });

    let asset = await this.prisma.asset.findFirst({
      where: { organizationId: 'org_demo', OR: [{ domain: data.assetId }, { ip: data.assetId }] },
    });

    // ─── Check duplicate BEFORE creating the asset if possible ──────────────
    // (asset may not exist yet on first run — re-checked below after upsert)

    if (!asset) {
      asset = await this.prisma.asset.create({
        data: {
          organizationId: 'org_demo',
          domain: data.assetId.includes('.') ? data.assetId : null,
          ip: !data.assetId.includes('.') ? data.assetId : null,
          assetType: 'DOMAIN',
          criticality: 'MEDIUM',
          exposureScore: 0,
        },
      });
    } else {
      asset = await this.prisma.asset.update({ where: { id: asset.id }, data: { lastSeen: new Date() } });
    }

    // ─── Deduplication check ────────────────────────────────────────────────
    const existingFinding = await this.prisma.finding.findFirst({
      where: {
        assetId:     asset.id,
        contentHash,
        status:      { in: ['OPEN', 'IN_PROGRESS'] },
      },
      select: { id: true, seenCount: true },
    });

    if (existingFinding) {
      // Duplicate: bump counter, re-confirm in current scan (if provided)
      await this.prisma.finding.update({
        where: { id: existingFinding.id },
        data: {
          seenCount:  { increment: 1 },
          lastSeenAt: new Date(),
          ...(data.scanId ? { scanId: data.scanId } : {}),
        },
      });
      this.logger.debug(
        `Duplicate skipped — hash=${contentHash} seenCount=${existingFinding.seenCount + 1} findingId=${existingFinding.id}`,
      );
      return; // ← do NOT create a new finding or enqueue AI analysis
    }

    const finding = await this.prisma.finding.create({
      data: {
        assetId: asset.id,
        category: data.category || 'INFORMATIONAL',
        severity: data.severity || 'INFO',
        title: data.title,
        description: data.description,
        evidence: data.evidence || {},
        sourceTool: data.sourceTool,
        rawOutput: JSON.stringify(data),
        cve: data.cve,
        cvss: data.cvss,
        status: 'OPEN',
        contentHash,
        seenCount:  1,
        lastSeenAt: new Date(),
        scanId:      data.scanId ?? null,
        firstScanId: data.scanId ?? null,
      },
    });

    const findings = await this.prisma.finding.findMany({
      where: { assetId: asset.id, status: 'OPEN' },
      select: { severity: true, cvss: true },
    });
    const weights: Record<string, number> = { INFO: 1, LOW: 2, MEDIUM: 5, HIGH: 8, CRITICAL: 10 };
    let score = 0;
    let maxCvss = 0;
    for (const f of findings) {
      score += (weights[f.severity] || 1) * 10;
      if (f.cvss && f.cvss > maxCvss) maxCvss = f.cvss;
    }
    const normalized = Math.min(100, Math.round((score / (findings.length * 100 + 1)) * 100 + maxCvss));
    await this.prisma.asset.update({ where: { id: asset.id }, data: { exposureScore: normalized } });

    await this.telemetry.publish({
      id: crypto.randomUUID(),
      type: 'FINDING_NORMALIZED',
      source: 'NormalizationWorker',
      payload: {
        findingId: finding.id,
        assetId: asset.id,
        severity: finding.severity,
        sourceTool: finding.sourceTool,
        organizationId: 'org_demo',
      },
      timestamp: new Date(),
    });

    // ─── Audit: normalized finding ──────────────────────────────────────────
    await this.prisma.auditLog.create({
      data: {
        type: 'NORMALIZED',
        findingId: finding.id,
        parsedData: {
          assetId: asset.id,
          severity: finding.severity,
          title: finding.title,
          category: finding.category,
          sourceTool: finding.sourceTool,
          contentHash,
        },
      },
    });

    await this.aiQueue.add('analyze', { findingId: finding.id }, {
      attempts: 2,
      backoff: { type: 'fixed', delay: 5000 },
      removeOnComplete: 100,
    });

    // ─── Audit: AI enqueued ──────────────────────────────────────────────────
    await this.prisma.auditLog.create({
      data: { type: 'AI_ENQUEUED', findingId: finding.id },
    });

    this.logger.log(`Created finding ${finding.id}`);

    // ─── Immediate alert on new CRITICAL/HIGH finding ────────────────────────
    // Fires at ingest time — no need to wait for AI analysis
    this.alertEngine.evaluateNow({
      id:          finding.id,
      title:       finding.title,
      category:    finding.category,
      severity:    finding.severity,
      description: finding.description,
      cve:         finding.cve,
    }).catch(err => this.logger.warn(`Alert dispatch failed: ${err.message}`));
  }
}
