# Bu Dian Backend API

REST API untuk sistem deteksi alergen makanan. Menyediakan autentikasi, manajemen data produk, dan integrasi dengan ML service untuk deteksi alergen.

## Tech Stack

- NestJS 10.4 + TypeScript 5.5
- Sequelize ORM + MySQL 8
- JWT Authentication (passport-jwt)
- Swagger/OpenAPI Documentation
- Class Validator & Class Transformer

## Modul

| Modul | Deskripsi |
|-------|-----------|
| **Auth** | Register, Login, JWT tokens |
| **Users** | CRUD users (admin only) |
| **Categories** | Kategori produk |
| **Products** | Data produk makanan |
| **Ingredients** | Bahan/bahan tambahan produk |
| **Allergens** | Master data alergen (12 alergen Indonesia) |
| **Detections** | Upload gambar → ML service → simpan hasil |
| **Contents** | CMS halaman konten |
| **Dashboard** | Statistik admin |
| **Settings** | Pengaturan sistem |

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Konfigurasi environment

```bash
cp .env.example .env
```

Edit `.env` sesuai konfigurasi:

```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=budian_user
DB_PASS=budian_password
DB_NAME=budian_allergen
JWT_SECRET=change-this-to-a-secure-secret
JWT_EXPIRATION=7d
ML_SERVICE_URL=http://localhost:8000
ML_API_KEY=your-ml-api-key
PORT=3001
```

### 3. Database setup

```bash
# Jalankan migrasi
npm run db:migrate

# Insert data awal
npm run db:seed
```

### 4. Jalankan server

```bash
# Development (auto-reload)
npm run start:dev

# Production
npm run build
npm run start:prod
```

Server berjalan di http://localhost:3001

## API Endpoints

Semua endpoint menggunakan prefix `/api/v1`.

### Autentikasi

| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| POST | `/api/v1/auth/register` | Register user baru |
| POST | `/api/v1/auth/login` | Login, dapatkan JWT |

### Produk

| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | `/api/v1/products` | List semua produk |
| GET | `/api/v1/products/:id` | Detail produk |
| POST | `/api/v1/products` | Create produk (admin) |
| PATCH | `/api/v1/products/:id` | Update produk (admin) |
| DELETE | `/api/v1/products/:id` | Hapus produk (admin) |

### Deteksi

| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| POST | `/api/v1/detections` | Upload gambar untuk deteksi |
| GET | `/api/v1/detections` | History deteksi user |
| GET | `/api/v1/detections/:id` | Detail hasil deteksi |

### Lainnya

| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | `/api/v1/allergens` | Master data alergen |
| GET | `/api/v1/categories` | Kategori produk |
| GET | `/api/v1/dashboard` | Statistik dashboard |

## Swagger Docs

Swagger UI tersedia di: http://localhost:3001/api/docs

## Scripts

| Script | Deskripsi |
|--------|-----------|
| `npm run start:dev` | Jalankan dalam mode development |
| `npm run build` | Build untuk production |
| `npm run start:prod` | Jalankan production build |
| `npm run lint` | Jalankan ESLint |
| `npm run typecheck` | Type checking tanpa emit |
| `npm run db:migrate` | Jalankan migrasi database |
| `npm run db:migrate:undo` | Rollback migrasi |
| `npm run db:seed` | Insert data seed |
| `npm run db:seed:undo` | Hapus data seed |
| `npm run test` | Jalankan unit test |
| `npm run test:e2e` | Jalankan e2e test |
