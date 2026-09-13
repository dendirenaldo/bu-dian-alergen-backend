// Dipanggil SEBELUM file spec diimpor (lihat setupFiles di jest-e2e.json),
// sehingga jwtConfig() di AuthModule membaca secret yang benar.
process.env.JWT_SECRET = 'e2e-test-secret-min-32-chars-xxxxxxxx';
process.env.NODE_ENV = 'test';
process.env.ML_SERVICE_URL = 'http://ml-mock:8000';
process.env.ML_API_KEY = '';
