import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
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
import { PasswordResetToken } from './models/password-reset-token.model';
import { Op } from 'sequelize';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    @InjectModel(PasswordResetToken)
    private resetTokenModel: typeof PasswordResetToken,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException({ message: 'Email already registered', code: 'EMAIL_TAKEN' });
    }

    const user = await this.usersService.create({
      ...dto,
    } as any);

    const token = this.generateToken(user);
    return {
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      token,
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

    await this.usersService.updateLastLogin(user.id);

    const token = this.generateToken(user);
    return {
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
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

    await this.usersService.update(userId, { password: dto.newPassword } as any);
    return { message: 'Password changed successfully' };
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

  private async sendResetEmail(to: string, token: string) {
    const base = (process.env.FRONTEND_URL || process.env.APP_URL || '').replace(/\/$/, '');
    const link = base ? `${base}/reset-password?token=${token}` : token;
    const subject = 'Reset password akun Anda';
    const text =
      `Kami menerima permintaan reset password untuk akun ini.\n\n` +
      `Gunakan tautan/token berikut (berlaku 1 jam):\n${link}\n\n` +
      `Jika Anda tidak meminta reset, abaikan email ini.`;

    if (!process.env.SMTP_HOST) {
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.log(`[dev] password reset for ${to}: token=${token} link=${link}`);
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
