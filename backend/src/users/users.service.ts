import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findAll(orgId: string) {
    return this.prisma.user.findMany({
      where: { organizationId: orgId },
      select: { id: true, email: true, name: true, roleId: true, isActive: true, createdAt: true, role: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, name: true, organizationId: true, roleId: true, isActive: true, createdAt: true, role: { select: { id: true, name: true, permissions: true } } },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return user;
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  }

  async create(orgId: string, dto: { email: string; password: string; name: string; roleId?: string }) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (existing) throw new ConflictException('El email ya está en uso');
    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.user.create({
      data: { email: dto.email.toLowerCase(), passwordHash, name: dto.name, organizationId: orgId, roleId: dto.roleId ?? null },
      select: { id: true, email: true, name: true, roleId: true, isActive: true, createdAt: true },
    });
    return user;
  }

  async update(id: string, dto: { name?: string; roleId?: string; password?: string }) {
    const data: any = {};
    if (dto.name) data.name = dto.name;
    if (dto.roleId !== undefined) data.roleId = dto.roleId;
    if (dto.password) data.passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.user.update({
      where: { id },
      data,
      select: { id: true, email: true, name: true, roleId: true, isActive: true, updatedAt: true },
    });
    return user;
  }

  async deactivate(id: string) {
    return this.prisma.user.update({ where: { id }, data: { isActive: false }, select: { id: true, isActive: true } });
  }

  async activate(id: string) {
    return this.prisma.user.update({ where: { id }, data: { isActive: true }, select: { id: true, isActive: true } });
  }
}
