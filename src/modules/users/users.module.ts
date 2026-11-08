import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { User } from './models/user.model';
import { EmailVerificationToken } from '../auth/models/email-verification-token.model';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [SequelizeModule.forFeature([User, EmailVerificationToken])],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [SequelizeModule, UsersService],
})
export class UsersModule {}
