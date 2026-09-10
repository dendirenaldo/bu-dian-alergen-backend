'use strict';

const bcrypt = require('bcrypt');

module.exports = {
  async up(queryInterface, Sequelize) {
    const hashedPassword = await bcrypt.hash('Admin123', 10);
    await queryInterface.bulkInsert('users', [
      {
        email: 'admin@budian.id',
        password: hashedPassword,
        name: 'Administrator',
        phone: '08123456789',
        role: 'admin',
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('users', { email: 'admin@budian.id' });
  },
};
