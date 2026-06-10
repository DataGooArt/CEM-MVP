import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { IsString, IsOptional, IsArray, IsBoolean, Matches } from 'class-validator';
import { DomainsService } from './domains.service';
import { Public } from './common/public.decorator';

// Accepts: hostname (example.com, sub.example.co.uk),
//          IPv4 (192.168.1.1), IPv4 CIDR (192.168.1.0/24)
const DOMAIN_OR_IP_RE =
  /^(([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}|(\d{1,3}\.){3}\d{1,3}(\/([0-9]|[1-2][0-9]|3[0-2]))?)$/;

class CreateDomainDto {
  @IsString()
  @Matches(DOMAIN_OR_IP_RE, {
    message: 'domain debe ser un hostname válido (ej. example.com) o una dirección IPv4 (ej. 192.168.1.1)',
  })
  domain: string;

  @IsOptional()
  @IsArray()
  tools?: string[];

  @IsOptional()
  @IsString()
  cronExpr?: string;

  @IsOptional()
  @IsString()
  scanProfile?: string;
}

class UpdateDomainDto {
  @IsOptional()
  @IsArray()
  tools?: string[];

  @IsOptional()
  @IsString()
  cronExpr?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  scanProfile?: string;
}

@Public()
@Controller('api/v1/domains')
export class DomainsController {
  constructor(private readonly svc: DomainsService) {}

  @Get()
  list(@Query('orgId') orgId?: string) {
    return this.svc.list(orgId ?? 'org_demo');
  }

  @Get('pending')
  pending() {
    return this.svc.pendingScans();
  }

  @Post()
  create(@Body() dto: CreateDomainDto, @Query('orgId') orgId?: string) {
    return this.svc.create(dto, orgId ?? 'org_demo');
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateDomainDto) {
    return this.svc.update(id, dto);
  }

  @Delete('scan-jobs/stale')
  clearStaleScans() {
    return this.svc.clearStaleScans();
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }

  @Get(':id/config-preview')
  configPreview(@Param('id') id: string) {
    return this.svc.configPreview(id);
  }

  @Post(':id/scan-complete')
  markScanned(@Param('id') id: string) {
    return this.svc.markScanned(id);
  }

  @Post(':id/scan')
  triggerScan(@Param('id') id: string) {
    return this.svc.triggerScan(id);
  }
}
