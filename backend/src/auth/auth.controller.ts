import { Controller, Post, Body, UseGuards, Request, Get, Patch, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { IsEmail, IsString, IsBoolean, MinLength } from 'class-validator';
import { AuthService } from './auth.service';
import { Public } from '../common/public.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';

class LoginDto {
  @IsEmail() email: string;
  @IsString() @MinLength(6) password: string;
}

class RefreshDto {
  @IsString() refreshToken: string;
}

class RegisterDto {
  @IsEmail() email: string;
  @IsString() @MinLength(8) password: string;
  @IsString() name: string;
  @IsString() organizationName: string;
}

class VerifyOtpDto {
  @IsString() pendingToken: string;
  @IsString() code: string;
}

class Toggle2FADto {
  @IsString() password: string;
  @IsBoolean() enabled: boolean;
}

@ApiTags('auth')
@Controller('api/v1/auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @UseGuards(AuthGuard('local'))
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Iniciar sesión — devuelve accessToken + refreshToken' })
  async login(@Request() req: any, @Body() _: LoginDto) {
    return this.authService.login(req.user);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Renovar access token usando refresh token' })
  async refresh(@Body() dto: RefreshDto) {
    return this.authService.refreshToken(dto.refreshToken);
  }

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Registrar primera cuenta admin + organización nueva' })
  async register(@Body() dto: RegisterDto) {
    return this.authService.registerAdmin(dto);
  }

  @Post('logout')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cerrar sesión — revoca tokens' })
  async logout(@Request() req: any) {
    const user = req.user;
    // Decodificar exp del access token
    const token = req.headers.authorization?.replace('Bearer ', '');
    let exp = Math.floor(Date.now() / 1000) + 900;
    if (token) {
      try {
        const decoded: any = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
        if (decoded.exp) exp = decoded.exp;
      } catch {}
    }
    await this.authService.logout(user.userId, user.jti, exp);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtener datos del usuario autenticado' })
  async me(@Request() req: any) {
    return this.authService.getMe(req.user.userId);
  }

  @Public()
  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verificar código OTP del segundo factor' })
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto.pendingToken, dto.code);
  }

  @Patch('2fa/toggle')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activar o desactivar segundo factor de autenticación' })
  async toggle2FA(@Request() req: any, @Body() dto: Toggle2FADto) {
    return this.authService.toggle2FA(req.user.userId, dto.enabled, dto.password);
  }
}
