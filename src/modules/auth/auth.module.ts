import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { jwtConfig } from '../../config/jwt.config';
import { User } from '../users/models/user.model';
import { PasswordResetToken } from './models/password-reset-token.model';
import { EmailVerificationToken } from './models/email-verification-token.model';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    SequelizeModule.forFeature([User, PasswordResetToken, EmailVerificationToken]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register(jwtConfig()),
    UsersModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [JwtModule, AuthService],
})
export class AuthModule {}
