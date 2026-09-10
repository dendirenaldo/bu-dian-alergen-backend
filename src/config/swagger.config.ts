import { DocumentBuilder } from '@nestjs/swagger';

export const swaggerConfig = new DocumentBuilder()
  .setTitle('Bu Dian Allergen Detection API')
  .setDescription('API untuk sistem deteksi alergen makanan')
  .setVersion('1.0')
  .addBearerAuth()
  .addTag('auth', 'Authentication')
  .addTag('users', 'User Management')
  .addTag('categories', 'Product Categories')
  .addTag('products', 'Product Management')
  .addTag('allergens', 'Allergen Data')
  .addTag('detections', 'Allergen Detection')
  .addTag('contents', 'CMS Content')
  .addTag('dashboard', 'Dashboard Statistics')
  .build();
