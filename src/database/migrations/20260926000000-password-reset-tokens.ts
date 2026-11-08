import { QueryInterface, DataTypes } from 'sequelize';

export async function up(queryInterface: QueryInterface) {
  const tables = await queryInterface.showAllTables();
  const names = (tables as any[]).map((t) => (typeof t === 'string' ? t : (t as any).tableName || Object.values(t as any)[0]));
  if (!names.includes('password_reset_tokens')) {
    await queryInterface.createTable('password_reset_tokens', {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      token_hash: { type: DataTypes.STRING(64), allowNull: false, unique: true },
      expires_at: { type: DataTypes.DATE, allowNull: false },
      used_at: { type: DataTypes.DATE, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    });
    await queryInterface.addIndex('password_reset_tokens', ['user_id']);
    await queryInterface.addIndex('password_reset_tokens', ['expires_at']);
  }
}

export async function down(queryInterface: QueryInterface) {
  const tables = await queryInterface.showAllTables();
  const names = (tables as any[]).map((t) => (typeof t === 'string' ? t : (t as any).tableName || Object.values(t as any)[0]));
  if (names.includes('password_reset_tokens')) {
    await queryInterface.dropTable('password_reset_tokens');
  }
}
