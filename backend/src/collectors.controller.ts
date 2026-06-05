import {
  Controller, Get, Post, Delete, Param, Body, Headers, Query,
  BadRequestException,
} from '@nestjs/common';
import { CollectorsService } from './collectors.service';

@Controller('api/v1/collectors')
export class CollectorsController {
  constructor(private readonly svc: CollectorsService) {}

  /**
   * Lista todos los parsers/plugins disponibles.
   * GET /api/v1/collectors/plugins
   */
  @Get('plugins')
  listPlugins() {
    return { plugins: this.svc.listPlugins() };
  }

  /**
   * Historial de sesiones de scan.
   * GET /api/v1/collectors/sessions?orgId=org_demo&limit=50
   */
  @Get('sessions')
  listSessions(
    @Query('orgId') orgId = 'org_demo',
    @Query('limit') limit = '50',
  ) {
    return this.svc.listSessions(orgId, Math.min(parseInt(limit, 10) || 50, 200));
  }

  /**
   * Recibe el output RAW de una herramienta y lo ingesta.
   * POST /api/v1/collectors/upload/:tool
   *
   * Headers:
   *   x-collector-id  — identificador del colector (ej: "kali" o nombre del dominio)
   *   x-scan-id       — UUID de sesión generado por full-scan.sh (opcional, para historial)
   *   Content-Type    — text/plain | application/xml | application/json
   */
  @Post('upload/:tool')
  async upload(
    @Param('tool') tool: string,
    @Headers('x-collector-id') collectorId: string,
    @Headers('x-scan-id') scanId: string | undefined,
    @Body() rawBody: unknown,
  ) {
    if (!collectorId) throw new BadRequestException('Header x-collector-id requerido');

    // NestJS puede entregar el body como Buffer, string u objeto según Content-Type
    let content: string;
    if (Buffer.isBuffer(rawBody)) {
      content = rawBody.toString('utf-8');
    } else if (typeof rawBody === 'string') {
      content = rawBody;
    } else if (rawBody && typeof rawBody === 'object') {
      content = JSON.stringify(rawBody);
    } else {
      content = String(rawBody ?? '');
    }

    if (!content.trim()) throw new BadRequestException('Body vacío — envía el output de la herramienta');

    return this.svc.upload(tool, content, collectorId, scanId);
  }

  /**
   * Recibe eventos de progreso del collector container y los emite via WebSocket.
   * POST /api/v1/collectors/scan-progress
   */
  @Post('scan-progress')
  async scanProgress(@Body() body: {
    scanId: string;
    collectorId: string;
    event: string;
    tool?: string;
    findingsCount?: number;
  }) {
    if (!body?.scanId || !body?.event) throw new BadRequestException('scanId y event son requeridos');
    await this.svc.handleScanProgress(body);
    return { ok: true };
  }

  /**
   * Cancela un scan activo por scanId.
   * DELETE /api/v1/collectors/scans/:scanId
   */
  @Delete('scans/:scanId')
  cancelScan(@Param('scanId') scanId: string) {
    return this.svc.cancelScan(scanId);
  }

  /**
   * Cancela todos los scans huérfanos (RUNNING/PENDING > 30 min).
   * DELETE /api/v1/collectors/scans?orgId=org_demo
   */
  @Delete('scans')
  cancelStaleScans(@Query('orgId') orgId = 'org_demo') {
    return this.svc.cancelAllStaleScans(orgId);
  }
}
