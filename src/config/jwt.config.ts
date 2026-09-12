export const jwtConfig = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'JWT_SECRET belum dikonfigurasi. Set JWT_SECRET minimal 32 karakter di environment.',
      );
    }
    // eslint-disable-next-line no-console
    console.warn(
      '[security] JWT_SECRET memakai fallback dev. Set JWT_SECRET minimal 32 karakter.',
    );
  }
  return {
    secret: secret || 'dev-only-insecure-secret-min-32-chars-xxxx',
    signOptions: { expiresIn: process.env.JWT_EXPIRATION || '7d' },
  };
};
