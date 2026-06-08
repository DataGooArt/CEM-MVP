import { Controller, Get, Patch, Post, Param, Body, Request, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { IsOptional, IsString, IsEmail, IsObject } from 'class-validator';
import { OrganizationsService } from './organizations.service';
import { logoMulterOptions } from '../common/multer.config';

class UpdateOrgDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() legalName?: string;
  @IsOptional() @IsString() nit?: string;
  @IsOptional() @IsString() sector?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsEmail() contactEmail?: string;
  @IsOptional() @IsString() subscriptionPlan?: string;
}

@ApiTags('organizations')
@ApiBearerAuth()
@Controller('api/v1/organizations')
export class OrganizationsController {
  constructor(private orgsService: OrganizationsService) {}

  @Get('me')
  @ApiOperation({ summary: 'Obtener datos de la organización del usuario autenticado' })
  getMyOrg(@Request() req: any) {
    return this.orgsService.findById(req.user.orgId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener organización por ID' })
  findOne(@Param('id') id: string) {
    return this.orgsService.findById(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualizar datos de la organización' })
  update(@Param('id') id: string, @Body() dto: UpdateOrgDto) {
    return this.orgsService.update(id, dto);
  }

  @Post(':id/logo')
  @ApiOperation({ summary: 'Subir logotipo de la organización (imagen, máx 2MB)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', logoMulterOptions))
  uploadLogo(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    return this.orgsService.updateLogo(id, file.filename);
  }

  @Patch(':id/notifications')
  @ApiOperation({ summary: 'Actualizar configuración de notificaciones' })
  updateNotifications(@Param('id') id: string, @Body() settings: Record<string, any>) {
    return this.orgsService.updateNotifications(id, settings);
  }
}
