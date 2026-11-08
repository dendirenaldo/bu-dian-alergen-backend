require('dotenv').config();

const DB_USERNAME = process.env.DB_USER;
const DB_PASSWORD = process.env.DB_PASS;
const DB_DATABASE = process.env.DB_NAME;

module.exports = {
  development: {
    username: DB_USERNAME || 'root',
    password: DB_PASSWORD || 'password',
    database: DB_DATABASE || 'budian_dev',
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    dialect: 'mysql',
    logging: false,
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
