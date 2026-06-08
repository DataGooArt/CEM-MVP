import { Controller, Post, Get, Patch, Body, Param, Query, Headers, BadRequestException, NotFoundException, UploadedFile, UseInterceptors, Res } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { IsString, IsOptional, IsNumber, IsObject } from 'class-validator';
import { ApiTags, ApiBearerAuth, ApiConsumes, ApiOperation } from '@nestjs/swagger';
import { FindingsService } from './findings.service';
import { Public } from './common/public.decorator';
import { csvMulterOptions, evidenceMulterOptions } from './common/multer.config';

class IngestDto {
  @IsString() assetId: string;
  @IsString() category: string;
  @IsString() severity: string;
  @IsString() title: string;
  @IsOptional() @IsString() description?: string;
  @IsString() sourceTool: string;
  @IsOptional() @IsObject() evidence?: Record<string, unknown>;
  @IsOptional() @IsString() cve?: string;
  @IsOptional() @IsNumber() cvss?: number;
}

@ApiTags('findings')
@ApiBearerAuth()
@Controller('api/v1/findings')
export class FindingsController {
  constructor(private readonly svc: FindingsService) {}

  @Public()
  @Post('ingest')
  async ingest(
    @Body() dto: IngestDto,
    @Headers('x-collector-id') collectorId: string,
    @Headers('x-scan-id') scanId?: string,
  ) {
    if (!collectorId) throw new BadRequestException('x-collector-id required');
    return this.svc.ingest({ ...dto, scanId: scanId ?? null });
  }

  @Get('stats')
  async stats(@Query('organizationId') orgId: string) {
    if (!orgId) throw new BadRequestException('organizationId required');
    return this.svc.stats(orgId);
  }

  @Get()
  async list(
    @Query('organizationId') orgId: string,
    @Query('severity') severity?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (!orgId) throw new BadRequestException('organizationId required');
    return this.svc.listByOrg(orgId, { severity, includeAll: status === 'ALL', from, to });
  }

  @Get('severity-distribution')
  async severityDistribution(@Query('organizationId') orgId: string) {
    if (!orgId) throw new BadRequestException('organizationId required');
    return this.svc.severityDistribution(orgId);
  }

  @Get('remediation')
  async remediation(
    @Query('organizationId') orgId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (!orgId) throw new BadRequestException('organizationId required');
    return this.svc.remediationFindings(orgId, { from, to });
  }

  @Get('remediation-history')
  async remediationHistory(
    @Query('organizationId') orgId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('archived') archived?: string,
  ) {
    if (!orgId) throw new BadRequestException('organizationId required');
    const archivedBool = archived === 'true' ? true : archived === 'false' ? false : undefined;
    return this.svc.remediationHistory(orgId, { from, to, archived: archivedBool });
  }

  @Post('archive')
  async archive(
    @Body() body: { organizationId: string; daysOld?: number },
  ) {
    if (!body.organizationId) throw new BadRequestException('organizationId required');
    return this.svc.archiveOld(body.organizationId, body.daysOld ?? 90);
  }

  @Get('by-asset')
  async byAsset(@Query('organizationId') orgId: string) {
    if (!orgId) throw new BadRequestException('organizationId required');
    return this.svc.findingsByAsset(orgId);
  }

  @Patch(':id/tracking')
  async updateTracking(
    @Param('id') id: string,
    @Body() body: {
      status?: string;
      startDate?: string;
      endDate?: string;
      responsible?: string;
      postAnalysisDate?: string;
      closingDate?: string;
      remediationEvidence?: string;
      closingNotes?: string;
    },
  ) {
    if (!id) throw new BadRequestException('id required');
    return this.svc.updateTracking(id, body);
  }

  @Get(':id/analysis')
  async getAnalysis(@Param('id') id: string) {
    const analysis = await this.svc.getAnalysis(id);
    if (!analysis) throw new NotFoundException(`No hay análisis IA para el finding ${id}`);
    return analysis;
  }

  @Post(':id/analyze')
  async triggerAnalysis(
    @Param('id') id: string,
    @Body() body: { provider?: 'gemini' | 'ollama' } = {},
  ) {
    return this.svc.triggerAnalysis(id, body.provider);
  }

  @Post('reanalyze-batch')
  async reanalyzeBatch(
    @Body() body: { findingIds: string[]; provider?: 'gemini' | 'ollama' },
  ) {
    if (!body.findingIds?.length) throw new BadRequestException('findingIds requerido');
    return this.svc.reanalyzeBatch(body.findingIds, body.provider);
  }

  // ─── Manual finding ──────────────────────────────────────────────────────
  @Post('manual')
  @ApiOperation({ summary: 'Crear hallazgo manual (pentesting, cumplimiento, bug bounty, etc.)' })
  async createManual(@Body() dto: {
    organizationId: string;
    assetTarget: string;
    source: string;
    category: string;
    severity: string;
    title: string;
    description?: string;
    cve?: string;
    cvss?: number;
    responsible?: string;
    remediationEndDate?: string;
  }) {
    if (!dto.organizationId) throw new BadRequestException('organizationId requerido');
    if (!dto.assetTarget) throw new BadRequestException('assetTarget requerido');
    return this.svc.createManual(dto);
  }

  // ─── CSV Import ───────────────────────────────────────────────────────────
  @Get('import/template')
  @ApiOperation({ summary: 'Descargar plantilla CSV para importar hallazgos' })
  downloadTemplate(@Res() res: Response) {
    const buffer = this.svc.getCsvTemplate();
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="cem-hallazgos-plantilla.csv"',
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  @Post('import')
  @ApiOperation({ summary: 'Importar hallazgos desde archivo CSV/Excel' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', csvMulterOptions))
  async importCsv(
    @UploadedFile() file: Express.Multer.File,
    @Body('organizationId') orgId: string,
  ) {
    if (!orgId) throw new BadRequestException('organizationId requerido');
    if (!file) throw new BadRequestException('Archivo requerido');
    return this.svc.importFromCsv(file.path, orgId);
  }

  // ─── Evidence upload ─────────────────────────────────────────────────────
  @Post(':id/evidence')
  @ApiOperation({ summary: 'Adjuntar archivo de evidencia a un hallazgo (PDF/imagen/docx, máx 10MB)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', evidenceMulterOptions))
  async uploadEvidence(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Archivo requerido');
    return this.svc.addEvidenceFile(id, file.filename, file.originalname);
  }
}

