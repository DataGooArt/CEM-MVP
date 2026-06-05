import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaService } from './prisma.service';
import { FindingsController } from './findings.controller';
import { FindingsService } from './findings.service';
import { CollectorsController } from './collectors.controller';
import { CollectorsService } from './collectors.service';
import { AlertsController } from './alerts.controller';
import { DomainsController } from './domains.controller';
import { DomainsService } from './domains.service';
import { NormalizationWorker } from './normalization.worker';
import { AiAnalysisWorker } from './ai-analysis.worker';
import { ScanReportWorker } from './scan-report.worker';
import { AlertEngine } from './alert.engine';
import { RealtimeGateway } from './realtime.gateway';
import { TelemetryService } from './telemetry.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [
    BullModule.forRoot({
      connection: { url: process.env.REDIS_URL || 'redis://redis:6379' },
    }),
    BullModule.registerQueue({ name: 'findings-ingest' }),
    BullModule.registerQueue({ name: 'findings-ai' }),
    BullModule.registerQueue({ name: 'scan-reports-ai' }),
  ],
  controllers: [FindingsController, CollectorsController, AlertsController, DomainsController, ReportsController],
  providers: [PrismaService, FindingsService, CollectorsService, DomainsService, NormalizationWorker, AiAnalysisWorker, ScanReportWorker, AlertEngine, RealtimeGateway, TelemetryService, ReportsService],
})
export class AppModule {}
