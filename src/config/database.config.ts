import { SequelizeModuleOptions } from '@nestjs/sequelize';

export const databaseConfig = (): SequelizeModuleOptions => ({
  dialect: 'mysql',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  username: process.env.DB_USER || 'budian_user',
  password: process.env.DB_PASS || 'budian_password',
  database: process.env.DB_NAME || 'budian_allergen',
  autoLoadModels: true,
  synchronize: false,
  dialectOptions: {
    charset: 'utf8mb4',
  },
  define: {
    timestamps: true,
    underscored: true,
  },
});
