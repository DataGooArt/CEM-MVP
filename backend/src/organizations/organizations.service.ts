import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { join } from 'path';

@Injectable()
export class OrganizationsService {
  constructor(private prisma: PrismaService) {}

  async findById(id: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id },
      select: { id: true, name: true, legalName: true, nit: true, sector: true, address: true, city: true, country: true, phone: true, contactEmail: true, logoUrl: true, subscriptionPlan: true, notificationSettings: true, createdAt: true, updatedAt: true },
    });
    if (!org) throw new NotFoundException('Organización no encontrada');
    return org;
  }

  async update(id: string, dto: {
    name?: string; legalName?: string; nit?: string; sector?: string;
    address?: string; city?: string; country?: string; phone?: string;
    contactEmail?: string; subscriptionPlan?: string;
  }) {
    return this.prisma.organization.update({
      where: { id },
      data: dto,
      select: { id: true, name: true, legalName: true, nit: true, sector: true, address: true, city: true, country: true, phone: true, contactEmail: true, logoUrl: true, subscriptionPlan: true, updatedAt: true },
    });
  }

  async updateLogo(id: string, filename: string) {
    const logoUrl = `/uploads/logos/${filename}`;
    return this.prisma.organization.update({
      where: { id },
      data: { logoUrl },
      select: { id: true, logoUrl: true },
    });
  }

  async updateNotifications(id: string, settings: Record<string, any>) {
    return this.prisma.organization.update({
      where: { id },
      data: { notificationSettings: settings },
      select: { id: true, notificationSettings: true },
    });
  }
}
