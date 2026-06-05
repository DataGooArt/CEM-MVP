import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { NormalizationWorker } from './normalization.worker';
import { AiAnalysisWorker } from './ai-analysis.worker';
import { ScanReportWorker } from './scan-report.worker';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  app.get(NormalizationWorker).start();
  app.get(AiAnalysisWorker).start();
  app.get(ScanReportWorker).start();
  Logger.log('Worker started', 'Bootstrap');
}
bootstrap();
