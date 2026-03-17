import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Health check endpoint for Railway
  const httpAdapter = app.getHttpAdapter();
  httpAdapter.get('/health', (_req: any, res: any) => res.json({ status: 'ok' }));

  // Enable CORS
  app.enableCors({
    origin: process.env.FRONTEND_URL
      ? process.env.FRONTEND_URL.split(',').map((s: string) => s.trim())
      : ['http://localhost:3000'],
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
