import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class RolesService {
  constructor(private prisma: PrismaService) {}

  async findAll(orgId: string) {
    return this.prisma.role.findMany({
      where: { OR: [{ organizationId: orgId }, { organizationId: null }] },
      orderBy: { name: 'asc' },
    });
  }

  async findById(id: string) {
    const role = await this.prisma.role.findUnique({ where: { id } });
    if (!role) throw new NotFoundException('Rol no encontrado');
    return role;
  }

  async create(orgId: string, dto: { name: string; permissions: string[]; isDefault?: boolean }) {
    return this.prisma.role.create({
      data: { name: dto.name, permissions: dto.permissions, isDefault: dto.isDefault ?? false, organizationId: orgId },
    });
  }

  async update(id: string, dto: { name?: string; permissions?: string[]; isDefault?: boolean }) {
    return this.prisma.role.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    // Desasignar usuarios que tengan este rol antes de eliminarlo
    await this.prisma.user.updateMany({ where: { roleId: id }, data: { roleId: null } });
    return this.prisma.role.delete({ where: { id } });
  }

  async seedDefaults(orgId: string) {
    const defaults = [
      { name: 'admin', permissions: ['*'], isDefault: false },
      { name: 'supervisor', permissions: ['findings:read', 'findings:write', 'remediations:write', 'domains:read', 'domains:write', 'reports:read', 'alerts:read', 'alerts:write'], isDefault: false },
      { name: 'viewer', permissions: ['findings:read', 'remediations:read', 'domains:read', 'reports:read', 'alerts:read'], isDefault: true },
    ];
    return Promise.all(
      defaults.map(r => this.prisma.role.upsert({
        where: { id: `${orgId}-${r.name}` },
        update: {},
        create: { id: `${orgId}-${r.name}`, ...r, organizationId: orgId },
      }))
    );
  }
}
