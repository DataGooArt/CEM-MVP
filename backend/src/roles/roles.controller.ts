import { Controller, Get, Post, Patch, Delete, Param, Body, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsString, IsArray, IsOptional, IsBoolean } from 'class-validator';
import { RolesService } from './roles.service';

class CreateRoleDto {
  @IsString() name: string;
  @IsArray() @IsString({ each: true }) permissions: string[];
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

class UpdateRoleDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) permissions?: string[];
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

@ApiTags('roles')
@ApiBearerAuth()
@Controller('api/v1/roles')
export class RolesController {
  constructor(private rolesService: RolesService) {}

  @Get()
  @ApiOperation({ summary: 'Listar roles de la organización' })
  findAll(@Request() req: any) {
    return this.rolesService.findAll(req.user.orgId);
  }

  @Post()
  @ApiOperation({ summary: 'Crear rol personalizado' })
  create(@Request() req: any, @Body() dto: CreateRoleDto) {
    return this.rolesService.create(req.user.orgId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener rol por ID' })
  findOne(@Param('id') id: string) {
    return this.rolesService.findById(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualizar rol (nombre y/o permisos)' })
  update(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.rolesService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Eliminar rol (desasigna usuarios primero)' })
  remove(@Param('id') id: string) {
    return this.rolesService.remove(id);
  }
}
