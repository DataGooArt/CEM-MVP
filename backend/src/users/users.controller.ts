import { Controller, Get, Post, Patch, Delete, Param, Body, Request, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsEmail, IsString, IsOptional, MinLength } from 'class-validator';
import { UsersService } from './users.service';

class CreateUserDto {
  @IsEmail() email: string;
  @IsString() @MinLength(8) password: string;
  @IsString() name: string;
  @IsOptional() @IsString() roleId?: string;
}

class UpdateUserDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() roleId?: string;
  @IsOptional() @IsString() @MinLength(8) password?: string;
}

@ApiTags('users')
@ApiBearerAuth()
@Controller('api/v1/users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'Listar usuarios de la organización' })
  findAll(@Request() req: any) {
    return this.usersService.findAll(req.user.orgId);
  }

  @Post()
  @ApiOperation({ summary: 'Crear usuario en la organización' })
  create(@Request() req: any, @Body() dto: CreateUserDto) {
    return this.usersService.create(req.user.orgId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener usuario por ID' })
  findOne(@Param('id') id: string) {
    return this.usersService.findById(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualizar usuario (nombre, rol, contraseña)' })
  update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.update(id, dto);
  }

  @Patch(':id/deactivate')
  @ApiOperation({ summary: 'Desactivar usuario (soft delete)' })
  deactivate(@Param('id') id: string) {
    return this.usersService.deactivate(id);
  }

  @Patch(':id/activate')
  @ApiOperation({ summary: 'Reactivar usuario' })
  activate(@Param('id') id: string) {
    return this.usersService.activate(id);
  }
}
