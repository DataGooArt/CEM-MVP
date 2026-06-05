import { Controller, Get, Post, Param, Query } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ReportsService } from './reports.service';

@Controller('api/v1/reports')
export class ReportsController {
  constructor(
    private readonly svc: ReportsService,
    @InjectQueue('scan-reports-ai') private readonly scanReportsQueue: Queue,
  ) {}

  /** Lista todos los informes de una organización */
  @Get()
  listReports(
    @Query('orgId') orgId = 'org_demo',
    @Query('domain') domain?: string,
  ) {
    return this.svc.listReports(orgId, domain);
  }

  /** Lista ScanJobs (historial de scans iniciados) */
  @Get('jobs')
  listJobs(@Query('orgId') orgId = 'org_demo') {
    return this.svc.listJobs(orgId);
  }

  /** Lista todos los informes ejecutivos de IA de una organización
   *  IMPORTANT: debe ir ANTES de ':scanId' para no ser capturado como parámetro */
  @Get('ai-reports/list')
  listAiReports(@Query('orgId') orgId = 'org_demo') {
    return this.svc.listAiReports(orgId);
  }

  /** Obtiene el informe ejecutivo de IA de un scan */
  @Get(':scanId/ai-report')
  getAiReport(@Param('scanId') scanId: string) {
    return this.svc.getAiReport(scanId);
  }

  /** Dispara (o re-dispara) la generación del informe ejecutivo de IA */
  @Post(':scanId/ai-report/generate')
  async triggerAiReport(
    @Param('scanId') scanId: string,
    @Query('orgId') orgId = 'org_demo',
  ) {
    const job = await this.svc.getJobMeta(scanId);
    const asset = job?.domain ?? scanId;
    await this.scanReportsQueue.add(
      'generate-executive',
      { scanId, asset, orgId },
      { attempts: 2, backoff: { type: 'exponential', delay: 3000 } },
    );
    return { queued: true, scanId };
  }

  /** Obtiene el informe completo de un scan (genera si no existe aún) */
  @Get(':scanId')
  getReport(@Param('scanId') scanId: string) {
    return this.svc.getReport(scanId);
  }

  /** Genera o regenera el informe de un scan */
  @Post(':scanId/generate')
  generateReport(
    @Param('scanId') scanId: string,
    @Query('force') force = 'false',
  ) {
    return this.svc.generateScanReport(scanId, force === 'true');
  }
}

