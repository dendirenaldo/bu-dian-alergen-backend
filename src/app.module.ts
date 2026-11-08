import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { ProductsModule } from './modules/products/products.module';
import { IngredientsModule } from './modules/ingredients/ingredients.module';
import { AllergensModule } from './modules/allergens/allergens.module';
import { DetectionsModule } from './modules/detections/detections.module';
import { ContentsModule } from './modules/contents/contents.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { SettingsModule } from './modules/settings/settings.module';
import { DatasetModule } from './modules/dataset/dataset.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([
      // Moderat: longgar untuk pemakaian normal, kuota publik tetap ketat.
      { name: 'default', ttl: 60000, limit: 300 },
      { name: 'auth', ttl: 60000, limit: 60 },
      { name: 'public', ttl: 3600000, limit: 6 },
    ]),
    DatabaseModule,
    AuthModule,
    UsersModule,
    CategoriesModule,
    ProductsModule,
    IngredientsModule,
    AllergensModule,
    DetectionsModule,
    ContentsModule,
    DashboardModule,
    SettingsModule,
    DatasetModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
