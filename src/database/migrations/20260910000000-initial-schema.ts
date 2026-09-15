import { QueryInterface, DataTypes } from 'sequelize';

export async function up(queryInterface: QueryInterface) {
  // --- Users ---
  await queryInterface.createTable('users', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    email: { type: DataTypes.STRING(255), allowNull: false, unique: true },
    password: { type: DataTypes.STRING(255), allowNull: false },
    name: { type: DataTypes.STRING(255), allowNull: false },
    phone: { type: DataTypes.STRING(20), allowNull: true },
    avatar_url: { type: DataTypes.STRING(500), allowNull: true },
    role: { type: DataTypes.ENUM('admin', 'user'), defaultValue: 'user' },
    is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
    last_login_at: { type: DataTypes.DATE, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });

  // --- Categories ---
  await queryInterface.createTable('categories', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING(255), allowNull: false, unique: true },
    slug: { type: DataTypes.STRING(255), allowNull: false, unique: true },
    description: { type: DataTypes.TEXT, allowNull: true },
    image_url: { type: DataTypes.STRING(500), allowNull: true },
    sort_order: { type: DataTypes.INTEGER, defaultValue: 0 },
    is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });

  // --- Products ---
  await queryInterface.createTable('products', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING(255), allowNull: false },
    slug: { type: DataTypes.STRING(255), allowNull: false, unique: true },
    category_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'categories', key: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    },
    brand: { type: DataTypes.STRING(255), allowNull: true },
    barcode: { type: DataTypes.STRING(50), allowNull: true, unique: true },
    description: { type: DataTypes.TEXT, allowNull: true },
    image_url: { type: DataTypes.STRING(500), allowNull: true },
    created_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    },
    is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });

  // --- Ingredients ---
  await queryInterface.createTable('ingredients', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    product_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'products', key: 'id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    text: { type: DataTypes.TEXT, allowNull: false },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });

  // --- Allergens ---
  await queryInterface.createTable('allergens', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING(255), allowNull: false, unique: true },
    code: { type: DataTypes.STRING(50), allowNull: false, unique: true },
    description: { type: DataTypes.TEXT, allowNull: true },
    icon_url: { type: DataTypes.STRING(500), allowNull: true },
    severity_level: { type: DataTypes.ENUM('low', 'medium', 'high', 'critical'), defaultValue: 'medium' },
    color: { type: DataTypes.STRING(7), allowNull: true },
    is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });

  // --- Detections ---
  await queryInterface.createTable('detections', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'users', key: 'id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    product_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'products', key: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    },
    image_url: { type: DataTypes.STRING(500), allowNull: true },
    ocr_text: { type: DataTypes.TEXT, allowNull: true },
    raw_model_output: { type: DataTypes.JSON, allowNull: true },
    result: { type: DataTypes.ENUM('safe', 'unsafe'), allowNull: false },
    confidence_score: { type: DataTypes.FLOAT, defaultValue: 0 },
    processing_time_ms: { type: DataTypes.INTEGER, allowNull: true },
    detection_method: { type: DataTypes.ENUM('image_ocr', 'text_input'), allowNull: false },
    notes: { type: DataTypes.TEXT, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });

  // --- Detection Allergens ---
  await queryInterface.createTable('detection_allergens', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    detection_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'detections', key: 'id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    allergen_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'allergens', key: 'id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    confidence_score: { type: DataTypes.FLOAT, defaultValue: 0 },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });

  // --- Contents ---
  await queryInterface.createTable('contents', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    title: { type: DataTypes.STRING(255), allowNull: false },
    slug: { type: DataTypes.STRING(255), allowNull: false, unique: true },
    body: { type: DataTypes.TEXT('long'), allowNull: true },
    excerpt: { type: DataTypes.TEXT, allowNull: true },
    type: { type: DataTypes.ENUM('page', 'article', 'announcement'), defaultValue: 'page' },
    status: { type: DataTypes.ENUM('draft', 'published', 'archived'), defaultValue: 'draft' },
    featured_image_url: { type: DataTypes.STRING(500), allowNull: true },
    meta_title: { type: DataTypes.STRING(255), allowNull: true },
    meta_description: { type: DataTypes.TEXT, allowNull: true },
    published_at: { type: DataTypes.DATE, allowNull: true },
    created_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });

  // --- Settings ---
  await queryInterface.createTable('settings', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    key: { type: DataTypes.STRING(255), allowNull: false, unique: true },
    value: { type: DataTypes.TEXT, allowNull: true },
    type: { type: DataTypes.ENUM('string', 'number', 'boolean', 'json'), defaultValue: 'string' },
    description: { type: DataTypes.TEXT, allowNull: true },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });

  // --- Indexes ---
  await queryInterface.addIndex('detections', ['user_id']);
  await queryInterface.addIndex('detections', ['product_id']);
  await queryInterface.addIndex('detections', ['created_at']);
  await queryInterface.addIndex('detection_allergens', ['detection_id']);
  await queryInterface.addIndex('detection_allergens', ['allergen_id']);
  await queryInterface.addIndex('ingredients', ['product_id']);
  await queryInterface.addIndex('products', ['category_id']);
  await queryInterface.addIndex('products', ['created_by']);
  await queryInterface.addIndex('contents', ['type']);
  await queryInterface.addIndex('contents', ['status']);
  await queryInterface.addIndex('contents', ['slug']);

  // --- Seed: 12 standard allergens ---
  await queryInterface.bulkInsert('allergens', [
    { name: 'Gluten', code: 'GLUTEN', description: 'Wheat, barley, rye, oats', severity_level: 'high', color: '#E74C3C', is_active: true, created_at: new Date(), updated_at: new Date() },
    { name: 'Crustaceans', code: 'CRUSTACEANS', description: 'Shrimp, crab, lobster, prawn', severity_level: 'critical', color: '#C0392B', is_active: true, created_at: new Date(), updated_at: new Date() },
    { name: 'Eggs', code: 'EGGS', description: 'Chicken eggs and egg-derived products', severity_level: 'high', color: '#F39C12', is_active: true, created_at: new Date(), updated_at: new Date() },
    { name: 'Fish', code: 'FISH', description: 'All fish species', severity_level: 'high', color: '#3498DB', is_active: true, created_at: new Date(), updated_at: new Date() },
    { name: 'Peanuts', code: 'PEANUTS', description: 'Peanuts and peanut-derived products', severity_level: 'critical', color: '#8E44AD', is_active: true, created_at: new Date(), updated_at: new Date() },
    { name: 'Soybeans', code: 'SOYBEANS', description: 'Soy and soy-derived products', severity_level: 'medium', color: '#2ECC71', is_active: true, created_at: new Date(), updated_at: new Date() },
    { name: 'Milk', code: 'MILK', description: 'Cow milk and milk-derived products', severity_level: 'high', color: '#ECF0F1', is_active: true, created_at: new Date(), updated_at: new Date() },
    { name: 'Tree Nuts', code: 'TREE_NUTS', description: 'Almonds, walnuts, cashews, hazelnuts, etc.', severity_level: 'critical', color: '#D35400', is_active: true, created_at: new Date(), updated_at: new Date() },
    { name: 'Celery', code: 'CELERY', description: 'Celery stalks, leaves, seeds, roots', severity_level: 'medium', color: '#27AE60', is_active: true, created_at: new Date(), updated_at: new Date() },
    { name: 'Mustard', code: 'MUSTARD', description: 'Mustard seeds and mustard-derived products', severity_level: 'medium', color: '#F1C40F', is_active: true, created_at: new Date(), updated_at: new Date() },
    { name: 'Sesame', code: 'SESAME', description: 'Sesame seeds and tahini', severity_level: 'medium', color: '#BDC3C7', is_active: true, created_at: new Date(), updated_at: new Date() },
    { name: 'Sulphites', code: 'SULPHITES', description: 'Sulphur dioxide and sulphites (concentration >10mg/kg)', severity_level: 'low', color: '#95A5A6', is_active: true, created_at: new Date(), updated_at: new Date() },
  ]);

  // --- Seed: admin user (password: admin123 — bcrypt hash) ---
  await queryInterface.bulkInsert('users', [
    {
      name: 'Administrator',
      email: 'admin@budian.id',
      password: '$2b$10$YQ8GvJGKbLBqNiAsH.5hWOuRp.8k9r3uYxYqJxKjXcZ1pYvQzV0e',
      role: 'admin',
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
    },
  ]);

  // --- Seed: default settings ---
  await queryInterface.bulkInsert('settings', [
    { key: 'app_name', value: 'Allergen Detector', type: 'string', description: 'Application name', updated_at: new Date() },
    { key: 'app_description', value: 'Sistem Deteksi Alergen Makanan', type: 'string', description: 'Application description', updated_at: new Date() },
    { key: 'detection_confidence_threshold', value: '0.5', type: 'number', description: 'Minimum confidence score for allergen detection', updated_at: new Date() },
    { key: 'max_upload_size_mb', value: '10', type: 'number', description: 'Maximum image upload size in MB', updated_at: new Date() },
    { key: 'ml_service_url', value: 'http://localhost:8000', type: 'string', description: 'ML inference service URL', updated_at: new Date() },
    { key: 'registration_enabled', value: 'true', type: 'boolean', description: 'Allow new user registration', updated_at: new Date() },
  ]);
}

export async function down(queryInterface: QueryInterface) {
  await queryInterface.dropTable('detection_allergens');
  await queryInterface.dropTable('detections');
  await queryInterface.dropTable('ingredients');
  await queryInterface.dropTable('products');
  await queryInterface.dropTable('contents');
  await queryInterface.dropTable('settings');
  await queryInterface.dropTable('allergens');
  await queryInterface.dropTable('categories');
  await queryInterface.dropTable('users');
}
