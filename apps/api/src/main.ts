import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { AppModule } from './app.module';

async function bootstrap() {
  // Ensure uploads directory exists
  const uploadsDir = join(process.cwd(), 'uploads', 'properties');
  mkdirSync(uploadsDir, { recursive: true });
  console.log('📁 Uploads directory ready:', uploadsDir);

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Serve uploaded photos as static files
  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads/',
  });
  console.log('📂 Static file serving enabled: /uploads/');

  // Enable CORS
  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = process.env.PORT || 3001;
  await app.listen(port);

  // Startup diagnostics
  const svKey = process.env.GOOGLE_STREET_VIEW_API_KEY;
  console.log(`🚀 API server running on http://localhost:${port}`);
  console.log(`🌍 Street View API key: ${svKey ? `configured (${svKey.substring(0, 10)}...)` : 'NOT SET'}`);
}

bootstrap();
