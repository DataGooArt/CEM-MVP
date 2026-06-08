import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { OrganizationsService } from './organizations.service';
import { OrganizationsController } from './organizations.controller';
import { PrismaService } from '../prisma.service';

@Module({
  imports: [MulterModule.register({})],
  controllers: [OrganizationsController],
  providers: [OrganizationsService, PrismaService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
