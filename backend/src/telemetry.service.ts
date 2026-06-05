import { Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { PrismaService } from './prisma.service';

export interface TelemetryEvent {
  id: string;
  type: string;
  source: string;
  payload: Record<string, unknown>;
  timestamp: Date;
}

@Injectable()
export class TelemetryService {
  private readonly logger = new Logger(TelemetryService.name);
  private readonly redis: Redis;

  constructor(private readonly prisma: PrismaService) {
    this.redis = new Redis(process.env.REDIS_URL || 'redis://redis:6379');
  }

  async publish(event: TelemetryEvent) {
    try {
      await this.prisma.telemetryEvent.create({
        data: {
          type: event.type,
          source: event.source,
          payload: event.payload as any,
        },
      });
      await this.redis.publish('telemetry:broadcast', JSON.stringify(event));
      await this.redis.xadd('stream:telemetry', '*', 'type', event.type, 'source', event.source, 'payload', JSON.stringify(event.payload));
      this.logger.debug(`Telemetry ${event.type} published`);
    } catch (err: any) {
      this.logger.error(`Telemetry publish failed: ${err.message}`);
    }
  }
}
