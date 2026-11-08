import { QueryInterface } from 'sequelize';

/**
 * Rebranding: admin@budian.id → admin@allergendetector.id (DB yang sudah ada).
 * Idempoten: update hanya bila baris lama ada dan email baru belum dipakai.
 */
const OLD_EMAIL = 'admin@budian.id';
const NEW_EMAIL = 'admin@allergendetector.id';

export async function up(queryInterface: QueryInterface) {
  const [rows] = (await queryInterface.sequelize.query(
    'SELECT id, email FROM users WHERE email IN (:old, :new)',
    { replacements: { old: OLD_EMAIL, new: NEW_EMAIL } },
  )) as unknown as [Array<{ id: number; email: string }>, unknown];
  const hasOld = rows.some((r) => r.email === OLD_EMAIL);
  const hasNew = rows.some((r) => r.email === NEW_EMAIL);
  if (!hasOld || hasNew) return;
  await queryInterface.sequelize.query('UPDATE users SET email = :new WHERE email = :old', {
    replacements: { old: OLD_EMAIL, new: NEW_EMAIL },
  });
}

export async function down(queryInterface: QueryInterface) {
  const [rows] = (await queryInterface.sequelize.query(
    'SELECT id, email FROM users WHERE email IN (:old, :new)',
    { replacements: { old: OLD_EMAIL, new: NEW_EMAIL } },
  )) as unknown as [Array<{ id: number; email: string }>, unknown];
  const hasOld = rows.some((r) => r.email === OLD_EMAIL);
  const hasNew = rows.some((r) => r.email === NEW_EMAIL);
  if (!hasNew || hasOld) return;
  await queryInterface.sequelize.query('UPDATE users SET email = :old WHERE email = :new', {
    replacements: { old: OLD_EMAIL, new: NEW_EMAIL },
  });
}
