import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import { createHash, randomUUID } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { Redis } from 'ioredis';

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL_DAYS = 7;
const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  private redis: Redis;

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {
    this.redis = new Redis(process.env.REDIS_URL || 'redis://redis:6379');
  }

  async validateUser(email: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { role: true, organization: { select: { id: true, name: true } } },
    });
    if (!user || !user.isActive) return null;
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return null;
    const { passwordHash: _, ...result } = user;
    return result;
  }

  async login(user: any) {
    const tokens = await this.generateTokens(user);
    await this.saveRefreshToken(user.id, tokens.refreshToken);
    return tokens;
  }

  async refreshToken(token: string) {
    const hash = this.hashToken(token);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hash } });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token inválido o expirado');
    }

    // Rotar: revocar el anterior
    await this.prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });

    const user = await this.prisma.user.findUnique({
      where: { id: stored.userId },
      include: { role: true },
    });
    if (!user || !user.isActive) throw new UnauthorizedException();

    const tokens = await this.generateTokens(user);
    await this.saveRefreshToken(user.id, tokens.refreshToken);
    return tokens;
  }

  async logout(userId: string, jti: string, accessTokenExp: number) {
    // Revocar todos los refresh tokens del usuario
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    // Blacklist del access token hasta su expiración
    const ttlSeconds = Math.max(accessTokenExp - Math.floor(Date.now() / 1000), 1);
    await this.redis.set(`blacklist:${jti}`, '1', 'EX', ttlSeconds);
  }

  async registerAdmin(dto: { email: string; password: string; name: string; organizationName: string }) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (existing) throw new ConflictException('El email ya está registrado');

    const org = await this.prisma.organization.create({
      data: { name: dto.organizationName },
    });

    // Crear roles por defecto para la organización
    const adminRole = await this.seedDefaultRoles(org.id);

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        passwordHash,
        name: dto.name,
        organizationId: org.id,
        roleId: adminRole.id,
      },
      include: { role: true },
    });

    const { passwordHash: _, ...result } = user;
    return result;
  }

  async hashPassword(plain: string) {
    return bcrypt.hash(plain, BCRYPT_ROUNDS);
  }

  private async generateTokens(user: any) {
    const jti = randomUUID();
    const payload = {
      sub: user.id,
      email: user.email,
      orgId: user.organizationId,
      roleId: user.roleId ?? null,
      roleName: user.role?.name ?? null,
      permissions: user.role?.permissions ?? [],
      jti,
    };
    const accessToken = this.jwtService.sign(payload, { expiresIn: ACCESS_TOKEN_TTL });
    const refreshToken = randomUUID() + '-' + randomUUID();
    return { accessToken, refreshToken, user: { id: user.id, email: user.email, name: user.name, orgId: user.organizationId, role: user.role?.name ?? null, permissions: user.role?.permissions ?? [] } };
  }

  private async saveRefreshToken(userId: string, token: string) {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_TTL_DAYS);
    await this.prisma.refreshToken.create({
      data: { tokenHash: this.hashToken(token), userId, expiresAt },
    });
    return token;
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private async seedDefaultRoles(orgId: string) {
    const roles = [
      { name: 'admin', permissions: ['*'], isDefault: false },
      { name: 'supervisor', permissions: ['findings:read', 'findings:write', 'remediations:write', 'domains:read', 'domains:write', 'reports:read', 'alerts:read', 'alerts:write'], isDefault: false },
      { name: 'viewer', permissions: ['findings:read', 'remediations:read', 'domains:read', 'reports:read', 'alerts:read'], isDefault: true },
    ];
    const created = await Promise.all(
      roles.map(r => this.prisma.role.create({ data: { ...r, organizationId: orgId } }))
    );
    return created[0]; // admin role
  }
}
