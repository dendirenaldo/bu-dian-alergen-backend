export const jwtConfig = () => ({
  secret: process.env.JWT_SECRET || 'default-secret-change-me',
  signOptions: { expiresIn: process.env.JWT_EXPIRATION || '7d' },
});
