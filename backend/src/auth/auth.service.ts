import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import { createHash, randomUUID } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import * as nodemailer from 'nodemailer';
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
    if (user.twoFactorEnabled) {
      // Generate 6-digit OTP, store in Redis for 10 minutes
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      await this.redis.set(`otp:${user.id}`, code, 'EX', 600);
      await this.sendOtpEmail(user.email, code, user.name).catch((err) => {
        console.error('[2FA] Failed to send OTP email:', err?.message || err);
      });
      // Issue a short-lived pending token (purpose=otp, no access to API)
      const pendingToken = this.jwtService.sign(
        { sub: user.id, purpose: 'otp' },
        { expiresIn: '10m' },
      );
      return { requiresOtp: true, pendingToken };
    }
    const tokens = await this.generateTokens(user);
    await this.saveRefreshToken(user.id, tokens.refreshToken);
    return tokens;
  }

  async verifyOtp(pendingToken: string, code: string) {
    let payload: any;
    try {
      payload = this.jwtService.verify(pendingToken);
    } catch {
      throw new UnauthorizedException('Token de verificación expirado. Inicia sesión de nuevo.');
    }
    if (payload.purpose !== 'otp') throw new UnauthorizedException('Token inválido.');

    const stored = await this.redis.get(`otp:${payload.sub}`);
    if (!stored || stored !== code.trim()) {
      throw new UnauthorizedException('Código incorrecto o expirado.');
    }
    await this.redis.del(`otp:${payload.sub}`);

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { role: true, organization: { select: { id: true, name: true } } },
    });
    if (!user || !user.isActive) throw new UnauthorizedException();

    const tokens = await this.generateTokens(user);
    await this.saveRefreshToken(user.id, tokens.refreshToken);
    return tokens;
  }

  async getMe(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        twoFactorEnabled: true,
        role: { select: { name: true } },
        organization: { select: { id: true, name: true } },
      },
    });
  }

  async toggle2FA(userId: string, enable: boolean, password: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    if (typeof enable !== 'boolean') throw new UnauthorizedException('El campo enabled debe ser true o false.');
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Contraseña incorrecta.');
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: enable },
      select: { id: true, email: true, name: true, twoFactorEnabled: true },
    });
    return updated;
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

  private async sendOtpEmail(email: string, code: string, name: string) {
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
    if (!SMTP_USER || !SMTP_PASS) return;
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(SMTP_PORT || '587'),
      secure: false,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
    await transporter.sendMail({
      from: `"CEM Platform" <${SMTP_USER}>`,
      to: email,
      subject: 'Código de verificación CEM Platform',
      html: `
<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px">
  <div style="background:#0f172a;padding:20px 28px;border-radius:12px 12px 0 0;border:1px solid #1e293b">
    <h2 style="color:#f1f5f9;margin:0;font-size:18px">Verificación de acceso</h2>
    <p style="color:#94a3b8;font-size:13px;margin:6px 0 0">CEM — Continuous Exposure Monitoring</p>
  </div>
  <div style="background:#1e293b;padding:28px;border-radius:0 0 12px 12px;border:1px solid #334155;border-top:0">
    <p style="color:#cbd5e1;font-size:14px;margin:0 0 20px">Hola <strong>${name}</strong>, tu código de verificación es:</p>
    <div style="background:#0f172a;border:1px solid #475569;border-radius:8px;padding:20px;text-align:center;margin-bottom:20px">
      <span style="font-size:36px;font-weight:700;letter-spacing:12px;color:#38bdf8;font-family:monospace">${code}</span>
    </div>
    <p style="color:#64748b;font-size:12px;margin:0">Válido por <strong>10 minutos</strong>. No compartas este código con nadie.</p>
  </div>
</div>`,
    });
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
