import { QueryInterface, DataTypes } from 'sequelize';

export async function up(queryInterface: QueryInterface) {
  const tables = await queryInterface.showAllTables();
  const names = (tables as any[]).map((t) => (typeof t === 'string' ? t : (t as any).tableName || Object.values(t as any)[0]));

  if (!names.includes('email_verification_tokens')) {
    await queryInterface.createTable('email_verification_tokens', {
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
    await queryInterface.addIndex('email_verification_tokens', ['user_id']);
    await queryInterface.addIndex('email_verification_tokens', ['expires_at']);
  }

  try {
    const desc: any = await (queryInterface as any).describeTable('users');
    if (!desc || !desc['email_verified_at']) {
      await queryInterface.addColumn('users', 'email_verified_at', {
        type: DataTypes.DATE,
        allowNull: true,
      });
    }
  } catch {
    // Tabel users belum ada (fresh install via initial migration) — kolom ikut model sync; abaikan.
  }

  try {
    // Backfill: existing user dianggap sudah terverifikasi.
    await queryInterface.sequelize.query(
      'UPDATE users SET email_verified_at = COALESCE(email_verified_at, updated_at, created_at, CURRENT_TIMESTAMP) WHERE email_verified_at IS NULL',
    );
  } catch {
    // Abaikan bila kolom/tabel belum tersedia pada urutan migrasi tertentu.
  }
}

export async function down(queryInterface: QueryInterface) {
  const tables = await queryInterface.showAllTables();
  const names = (tables as any[]).map((t) => (typeof t === 'string' ? t : (t as any).tableName || Object.values(t as any)[0]));
  if (names.includes('email_verification_tokens')) {
    await queryInterface.dropTable('email_verification_tokens');
  }
  try {
    const desc: any = await (queryInterface as any).describeTable('users');
    if (desc && desc['email_verified_at']) {
      await queryInterface.removeColumn('users', 'email_verified_at');
    }
  } catch {
    // abaikan
  }
}
