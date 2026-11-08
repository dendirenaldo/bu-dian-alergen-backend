import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import * as nodemailer from 'nodemailer';
import { Op } from 'sequelize';
import { User } from './models/user.model';
import { EmailVerificationToken } from '../auth/models/email-verification-token.model';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

function verificationTtlHours(): number {
  const raw = parseInt(process.env.EMAIL_VERIFICATION_TTL_HOURS || '24', 10);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return 24;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User)
    private userModel: typeof User,
    @InjectModel(EmailVerificationToken)
    private verificationTokenModel: typeof EmailVerificationToken,
  ) {}

  async findAll(page = 1, limit = 10, verified?: string | boolean) {
    const offset = (page - 1) * limit;
    const where: any = {};
    if (verified === true || verified === 'true') {
      where.emailVerifiedAt = { [Op.ne]: null };
    } else if (verified === false || verified === 'false') {
      where.emailVerifiedAt = { [Op.eq]: null } as any;
      // Sequelize: IS NULL — gunakan null langsung agar kompatibel sqlite/mysql.
      where.emailVerifiedAt = null;
    }
    const { rows, count } = await this.userModel.findAndCountAll({
      where,
      offset,
      limit,
      order: [['createdAt', 'DESC']],
      attributes: { exclude: ['password'] },
    });
    return { data: rows, total: count, page, limit, totalPages: Math.ceil(count / limit) };
  }

  async findById(id: number) {
    const user = await this.userModel.findByPk(id, {
      attributes: { exclude: ['password'] },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async findByIdWithPassword(id: number) {
    const user = await this.userModel.findByPk(id);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async findByEmail(email: string) {
    return this.userModel.findOne({ where: { email } });
  }

  async create(dto: CreateUserDto) {
    const hashedPassword = await bcrypt.hash(dto.password, 10);
    return this.userModel.create({ ...dto, password: hashedPassword } as any);
  }

  async update(id: number, dto: UpdateUserDto) {
    const user = await this.findById(id);
    const payload: any = { ...dto };
    if (payload.password) {
      payload.password = await bcrypt.hash(payload.password, 10);
    }
    await user.update(payload);
    return user;
  }

  async remove(id: number) {
    const user = await this.findById(id);
    await user.destroy();
    return { message: 'User deleted' };
  }

  async updateLastLogin(id: number) {
    await this.userModel.update({ lastLoginAt: new Date() }, { where: { id } });
  }

  async markVerified(id: number) {
    const user = await this.findByIdWithPassword(id);
    if (!user.emailVerifiedAt) {
      await user.update({ emailVerifiedAt: new Date() } as any);
    }
    await this.verificationTokenModel.destroy({ where: { userId: id } } as any);
    const fresh = await this.findById(id);
    return {
      id: fresh.id,
      email: fresh.email,
      emailVerified: !!(fresh as any).emailVerifiedAt,
      emailVerifiedAt: (fresh as any).emailVerifiedAt ?? null,
    };
  }

  async unmarkVerified(id: number) {
    const user = await this.findByIdWithPassword(id);
    if (user.emailVerifiedAt) {
      await user.update({ emailVerifiedAt: null } as any);
    }
    const fresh = await this.findById(id);
    return {
      id: fresh.id,
      email: fresh.email,
      emailVerified: false,
      emailVerifiedAt: null,
    };
  }

  /** Admin: kirim ulang verifikasi berdasarkan user id. */
  async resendVerificationById(id: number) {
    const genericMessage = 'Jika email terdaftar dan belum terverifikasi, tautan verifikasi telah dikirim';
    const user = await this.findByIdWithPassword(id);
    if (!user.isActive) return { message: genericMessage };
    if ((user as any).emailVerifiedAt) {
      throw new BadRequestException({
        message: 'Email sudah terverifikasi',
        code: 'EMAIL_ALREADY_VERIFIED',
      });
    }
    await this.verificationTokenModel.destroy({
      where: { userId: user.id, usedAt: null as any },
    } as any);
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + verificationTtlHours() * 60 * 60 * 1000);
    await this.verificationTokenModel.create({ userId: user.id, tokenHash, expiresAt } as any);
    await this.sendVerificationEmail(user.email, token);
    return { message: genericMessage };
  }

  private async sendVerificationEmail(to: string, token: string) {
    const base = (process.env.FRONTEND_URL || process.env.APP_URL || '').replace(/\/$/, '');
    const scheme = (process.env.APP_MOBILE_SCHEME || 'allergendetector').replace(/:\/\/$/, '').trim() || 'allergendetector';
    const webLink = base ? `${base}/verify-email?token=${token}` : token;
    const deepLink = `${scheme}://verify-email?token=${token}`;
    const ttl = verificationTtlHours();
    const subject = 'Verifikasi email akun Anda';
    const text =
      `Verifikasi email Anda dengan tautan berikut (berlaku ${ttl} jam):\n${webLink}\n\n` +
      `Buka di aplikasi mobile:\n${deepLink}\n\n` +
      `Tautan universal (https, buka di browser/aplikasi):\n${webLink}\n`;
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
      await transporter.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, text });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.log('[warn] gagal kirim email verifikasi:', (e as any)?.message || e);
    }
  }
}
