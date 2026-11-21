import { SequelizeModuleOptions } from '@nestjs/sequelize';

export const databaseConfig = (): SequelizeModuleOptions => {
  // Mode SQLite khusus pengembangan/test lokal tanpa MySQL.
  // Opt-in eksplisit via DB_DIALECT=sqlite; default produksi tetap MySQL.
  if ((process.env.DB_DIALECT || '').toLowerCase() === 'sqlite') {
    return {
      dialect: 'sqlite',
      storage: process.env.DB_STORAGE || './.dev/allergen-dev.sqlite',
      autoLoadModels: true,
      synchronize: process.env.DB_SYNC !== 'false',
      logging: false,
      define: { timestamps: true, underscored: true },
    };
  }
  return {
    dialect: 'mysql',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    username: process.env.DB_USER || 'allergen_detector_user',
    password: process.env.DB_PASS || 'allergen_detector_password',
    database: process.env.DB_NAME || 'allergen_detector',
    autoLoadModels: true,
    synchronize: false,
    dialectOptions: {
      charset: 'utf8mb4',
    },
    define: {
      timestamps: true,
      underscored: true,
    },
  };
};
