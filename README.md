# Bu Dian Backend API

NestJS backend API untuk sistem deteksi alergen makanan.

## Tech Stack

- NestJS 10
- TypeScript
- Sequelize ORM + MySQL
- JWT Authentication
- Swagger Documentation
- Class Validation

## Modules

- **Auth** — Register, Login, JWT tokens
- **Users** — CRUD users (admin only)
- **Categories** — Product categories
- **Products** — Food products CRUD
- **Ingredients** — Product ingredients
- **Allergens** — Master allergen data (12 Indonesian allergens)
- **Detections** — Upload image → ML service → save result
- **Contents** — CMS pages
- **Dashboard** — Admin statistics
- **Settings** — System settings

## Setup

```bash
# Install dependencies
npm install

# Setup environment
cp .env.example .env
# Edit .env with your database credentials

# Run development
npm run start:dev

# Swagger docs
open http://localhost:3001/api/docs
```

## Environment Variables

```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=budian_user
DB_PASS=budian_password
DB_NAME=budian_allergen
JWT_SECRET=your-secret-key
JWT_EXPIRATION=7d
ML_SERVICE_URL=http://localhost:8000
ML_API_KEY=your-ml-api-key
PORT=3001
```

## API Documentation

Swagger UI available at `/api/docs` when server is running.
