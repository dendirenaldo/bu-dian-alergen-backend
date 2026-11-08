import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import * as nodemailer from 'nodemailer';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { PasswordResetToken } from './models/password-reset-token.model';
import { EmailVerificationToken } from './models/email-verification-token.model';
import { Op } from 'sequelize';

function verificationTtlHours(): number {
  const raw = parseInt(process.env.EMAIL_VERIFICATION_TTL_HOURS || '24', 10);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return 24;
}

function isVerificationRequired(): boolean {
  const raw = String(process.env.REQUIRE_EMAIL_VERIFICATION ?? 'true')
    .trim()
    .toLowerCase();
  return !['false', '0', 'no', 'off', 'disabled'].includes(raw);
}

function mobileScheme(): string {
  return (process.env.APP_MOBILE_SCHEME || 'budian').replace(/:\/\/$/, '').trim() || 'budian';
}

function webBase(): string {
  return (process.env.FRONTEND_URL || process.env.APP_URL || '').replace(/\/$/, '');
}

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    @InjectModel(PasswordResetToken)
    private resetTokenModel: typeof PasswordResetToken,
    @InjectModel(EmailVerificationToken)
    private verificationTokenModel: typeof EmailVerificationToken,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException({ message: 'Email already registered', code: 'EMAIL_TAKEN' });
    }

    const user = await this.usersService.create({
      ...dto,
    } as any);

    await this.requestVerification(user.id, user.email);

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        emailVerified: false,
      },
      message: 'Registrasi berhasil. Silakan verifikasi email Anda.',
    };
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) {
      throw new UnauthorizedException({ message: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException({ message: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });
    }

    if (!user.isActive) {
      throw new UnauthorizedException({ message: 'Account is deactivated', code: 'ACCOUNT_DISABLED' });
    }

    if (isVerificationRequired() && !user.emailVerifiedAt) {
      throw new ForbiddenException({
        message: 'Email belum diverifikasi. Silakan verifikasi email Anda.',
        code: 'EMAIL_NOT_VERIFIED',
      });
    }

    await this.usersService.updateLastLogin(user.id);

    const token = this.generateToken(user);
    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        emailVerified: !!user.emailVerifiedAt,
      },
      token,
    };
  }

  async getProfile(userId: number) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      avatarUrl: user.avatarUrl,
      role: user.role,
      emailVerified: !!user.emailVerifiedAt,
      emailVerifiedAt: user.emailVerifiedAt ?? null,
      createdAt: user.createdAt,
    };
  }

  async updateProfile(userId: number, dto: UpdateProfileDto) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    await user.update(dto);
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      avatarUrl: user.avatarUrl,
      role: user.role,
      emailVerified: !!user.emailVerifiedAt,
    };
  }

  async changePassword(userId: number, dto: ChangePasswordDto) {
    const user = await this.usersService.findByIdWithPassword(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const isPasswordValid = await bcrypt.compare(dto.currentPassword, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    if (dto.currentPassword === dto.newPassword) {
      throw new ConflictException('Password baru tidak boleh sama dengan password lama');
    }

    await this.usersService.update(user.id, { password: dto.newPassword } as any);
    return { message: 'Password changed successfully' };
  }

  async verifyEmail(dto: VerifyEmailDto) {
    const rawToken = String(dto.token ?? '').trim();
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const record = await this.verificationTokenModel.findOne({ where: { tokenHash } });
    const invalid = () =>
      new BadRequestException({
        message: 'Token verifikasi tidak valid atau sudah kedaluwarsa',
        code: 'TOKEN_EXPIRED',
      });
    if (!record || record.usedAt) throw invalid();
    if (!record.expiresAt || new Date(record.expiresAt).getTime() < Date.now()) throw invalid();

    let user: any = null;
    try {
      user = await this.usersService.findByIdWithPassword(record.userId);
    } catch {
      throw invalid();
    }
    if (!user) throw invalid();

    if (user.emailVerifiedAt) {
      throw new BadRequestException({
        message: 'Email sudah terverifikasi',
        code: 'EMAIL_ALREADY_VERIFIED',
      });
    }

    await user.update({ emailVerifiedAt: new Date() } as any);
    await record.update({ usedAt: new Date() } as any);
    await this.verificationTokenModel.destroy({
      where: { userId: user.id, usedAt: null as any, id: { [Op.ne]: record.id } as any },
    } as any);
    return { message: 'Email berhasil diverifikasi' };
  }

  async resendVerification(dto: ResendVerificationDto) {
    const email = String(dto.email ?? '').trim().toLowerCase();
    const genericMessage = 'Jika email terdaftar dan belum terverifikasi, tautan verifikasi telah dikirim';
    try {
      const user = await this.usersService.findByEmail(email);
      if (!user) return { message: genericMessage };
      if (!user.isActive) return { message: genericMessage };
      if (user.emailVerifiedAt) {
        throw new BadRequestException({
          message: 'Email sudah terverifikasi',
          code: 'EMAIL_ALREADY_VERIFIED',
        });
      }
      await this.requestVerification(user.id, user.email);
    } catch (e) {
      if (
        e instanceof BadRequestException &&
        (e.getResponse() as any)?.code === 'EMAIL_ALREADY_VERIFIED'
      ) {
        throw e;
      }
      // Selalu 200 agar tidak bocor enumerasi email; log untuk observability.
      // eslint-disable-next-line no-console
      if (process.env.NODE_ENV !== 'production') console.log('[dev] resend-verification error:', (e as any)?.message || e);
    }
    return { message: genericMessage };
  }

  /** Buat token verifikasi baru (invalidate lama), kirim email. Return token mentah (untuk dev log/test). */
  async requestVerification(userId: number, email: string): Promise<string> {
    await this.verificationTokenModel.destroy({
      where: { userId, usedAt: null as any },
    } as any);

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + verificationTtlHours() * 60 * 60 * 1000);
    await this.verificationTokenModel.create({ userId, tokenHash, expiresAt } as any);
    await this.sendVerificationEmail(email, token);
    return token;
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const email = String(dto.email ?? '').trim().toLowerCase();
    const genericMessage = 'Jika email terdaftar, tautan reset telah dikirim';
    try {
      const user = await this.usersService.findByEmail(email);
      if (!user) return { message: genericMessage };
      if (!user.isActive) return { message: genericMessage };

      await this.resetTokenModel.destroy({
        where: { userId: user.id, usedAt: null as any },
      } as any);

      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
      await this.resetTokenModel.create({ userId: user.id, tokenHash, expiresAt } as any);
      await this.sendResetEmail(user.email, token);
    } catch (e) {
      // Selalu 200 agar tidak bocor enumerasi email; log untuk observability.
      // eslint-disable-next-line no-console
      if (process.env.NODE_ENV !== 'production') console.log('[dev] forgot-password error:', (e as any)?.message || e);
    }
    return { message: genericMessage };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const rawToken = String(dto.token ?? '').trim();
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const record = await this.resetTokenModel.findOne({ where: { tokenHash } });
    const invalid = () =>
      new BadRequestException({
        message: 'Token reset tidak valid atau sudah kedaluwarsa',
        code: 'TOKEN_EXPIRED',
      });
    if (!record || record.usedAt) throw invalid();
    if (!record.expiresAt || new Date(record.expiresAt).getTime() < Date.now()) throw invalid();

    let user: any = null;
    try {
      user = await this.usersService.findById(record.userId);
    } catch {
      throw invalid();
    }
    if (!user) throw invalid();

    await this.usersService.update(user.id, { password: dto.newPassword } as any);
    await record.update({ usedAt: new Date() } as any);
    await this.resetTokenModel.destroy({
      where: { userId: user.id, usedAt: null as any, id: { [Op.ne]: record.id } as any },
    } as any);
    return { message: 'Password berhasil direset' };
  }

  private async sendVerificationEmail(to: string, token: string) {
    const base = webBase();
    const scheme = mobileScheme();
    const webLink = base ? `${base}/verify-email?token=${token}` : token;
    const deepLink = `${scheme}://verify-email?token=${token}`;
    const universalLink = webLink;
    const ttl = verificationTtlHours();
    const subject = 'Verifikasi email akun Anda';
    const text =
      `Terima kasih telah mendaftar. Verifikasi email Anda dengan tautan berikut (berlaku ${ttl} jam):\n${webLink}\n\n` +
      `Buka di aplikasi mobile:\n${deepLink}\n\n` +
      `Tautan universal (https, buka di browser/aplikasi):\n${universalLink}\n\n` +
      `Jika Anda tidak mendaftar akun ini, abaikan email ini.`;

    if (!process.env.SMTP_HOST) {
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.log(`[dev] email verification for ${to}: token=${token} link=${webLink} deeplink=${deepLink}`);
      }
      return;
    }
    try {
      const port = parseInt(process.env.SMTP_PORT || '587', 10);
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465,
        auth:
          process.env.SMTP_USER || process.env.SMTP_PASS
            ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
            : undefined,
      });
      await transporter.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to,
        subject,
        text,
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.log('[warn] gagal kirim email verifikasi:', (e as any)?.message || e);
    }
  }

  private async sendResetEmail(to: string, token: string) {
    const base = webBase();
    const scheme = mobileScheme();
    const link = base ? `${base}/reset-password?token=${token}` : token;
    const deepLink = `${scheme}://reset-password?token=${token}`;
    const subject = 'Reset password akun Anda';
    const text =
      `Kami menerima permintaan reset password untuk akun ini.\n\n` +
      `Gunakan tautan/token berikut (berlaku 1 jam):\n${link}\n\n` +
      `Buka di aplikasi mobile:\n${deepLink}\n` +
      `Tautan universal (https, buka di browser/aplikasi):\n${link}\n\n` +
      `Jika Anda tidak meminta reset, abaikan email ini.`;

    if (!process.env.SMTP_HOST) {
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.log(`[dev] password reset for ${to}: token=${token} link=${link} deeplink=${deepLink}`);
      }
      return;
    }
    try {
      const port = parseInt(process.env.SMTP_PORT || '587', 10);
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465,
        auth:
          process.env.SMTP_USER || process.env.SMTP_PASS
            ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
            : undefined,
      });
      await transporter.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to,
        subject,
        text,
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.log('[warn] gagal kirim email reset:', (e as any)?.message || e);
    }
  }

  private generateToken(user: any) {
    const payload = { sub: user.id, email: user.email, role: user.role };
    return this.jwtService.sign(payload);
  }
}
