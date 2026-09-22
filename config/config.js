require('dotenv').config();

// Nama env kanonis aplikasi (src/config/database.config.ts) adalah
// DB_USER/DB_PASS/DB_NAME. Fallback DB_USERNAME/DB_PASSWORD/DB_DATABASE
// dipertahankan agar kompatibel dengan setup lama (mis. comnets).
const DB_USERNAME = process.env.DB_USER || process.env.DB_USERNAME;
const DB_PASSWORD = process.env.DB_PASS || process.env.DB_PASSWORD;
const DB_DATABASE = process.env.DB_NAME || process.env.DB_DATABASE;

module.exports = {
  development: {
    username: DB_USERNAME || 'root',
    password: DB_PASSWORD || 'password',
    database: DB_DATABASE || 'budian_dev',
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    dialect: 'mysql',
    logging: console.log,
  },
  test: {
    username: DB_USERNAME || 'root',
    password: DB_PASSWORD || 'password',
    database: DB_DATABASE || 'budian_test',
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    dialect: 'mysql',
    logging: false,
  },
  production: {
    username: DB_USERNAME,
    password: DB_PASSWORD,
    database: DB_DATABASE,
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    dialect: 'mysql',
    logging: false,
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false,
      },
    },
  },
};
