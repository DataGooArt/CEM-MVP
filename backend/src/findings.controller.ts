import { Controller, Post, Get, Patch, Body, Param, Query, Headers, BadRequestException } from '@nestjs/common';
import { IsString, IsOptional, IsNumber, IsObject } from 'class-validator';
import { FindingsService } from './findings.service';

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

@Controller('api/v1/findings')
export class FindingsController {
  constructor(private readonly svc: FindingsService) {}

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
}
