import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { createHash } from 'node:crypto';
import { Redis } from 'ioredis';

export interface JwtPayload {
  sub: string;
  email: string;
  orgId: string;
  roleId: string | null;
  roleName: string | null;
  permissions: string[];
  jti: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private redis: Redis;

  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'cem-jwt-secret-change-in-production',
    });
    this.redis = new Redis(process.env.REDIS_URL || 'redis://redis:6379');
  }

  async validate(payload: JwtPayload) {
    // Chequear blacklist (tokens revocados)
    const blacklisted = await this.redis.get(`blacklist:${payload.jti}`);
    if (blacklisted) throw new UnauthorizedException('Token revocado');
    return {
      userId: payload.sub,
      email: payload.email,
      orgId: payload.orgId,
      roleId: payload.roleId,
      roleName: payload.roleName,
      permissions: payload.permissions ?? [],
      jti: payload.jti,
    };
  }
}
