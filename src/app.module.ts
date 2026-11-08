import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { ThrottlerBehindProxyGuard } from './common/guards/throttler-proxy.guard';
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
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const num = (v: string | undefined, fb: number) => {
          const n = Number(v);
          return Number.isFinite(n) && n > 0 ? n : fb;
        };
        // Bucket global longgar per sidik (IP + UA): 3000 req/60 dtk.
        // Kalibrasi ala bpu-unsri: ~18 request/load halaman -> ~165 load/mnt.
        const ttlSec = num(config.get<string>('THROTTLE_TTL'), 60);
        return [
          { name: 'default', ttl: ttlSec * 1000, limit: num(config.get<string>('THROTTLE_LIMIT'), 3000) },
          { name: 'auth', ttl: 60000, limit: num(config.get<string>('THROTTLE_AUTH_LIMIT'), 60) },
          // Kuota publik (anon) tetap ketat: 6/jam.
          { name: 'public', ttl: 3600000, limit: 6 },
        ];
      },
    }),
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
    HealthModule,
  ],
  providers: [
    // Urutan penting: auth/roles dulu, throttle terakhir — 401/403 tak bakar kuota.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ThrottlerBehindProxyGuard },
  ],
})
export class AppModule {}
