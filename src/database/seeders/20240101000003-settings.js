'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.bulkInsert('settings', [
      {
        key: 'app_name',
        value: 'Allergen Detector',
        type: 'string',
        description: 'Nama aplikasi',
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        key: 'app_version',
        value: '1.0.0',
        type: 'string',
        description: 'Versi aplikasi',
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        key: 'ml_service_url',
        value: 'http://localhost:8000',
        type: 'string',
        description: 'URL service ML untuk deteksi alergen',
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        key: 'max_upload_size',
        value: '10485760',
        type: 'number',
        description: 'Ukuran maksimal upload file dalam bytes (10MB)',
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        key: 'allowed_image_types',
        value: '["image/jpeg","image/png","image/webp"]',
        type: 'json',
        description: 'Tipe file gambar yang diizinkan',
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        key: 'default_pagination_limit',
        value: '10',
        type: 'number',
        description: 'Default limit untuk pagination',
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        key: 'registration_enabled',
        value: 'true',
        type: 'boolean',
        description: 'Apakah registrasi user baru diizinkan',
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('settings', null, {});
  },
};
