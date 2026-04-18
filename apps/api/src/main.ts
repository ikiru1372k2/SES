import './load-env';
import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { NestFactory } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { createRequestId, requestContext } from './common/request-context';

function assertProductionSecrets(): void {
  if (process.env.NODE_ENV !== 'production') {
    return;
  }
  const secret = process.env.SES_AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      'In production, SES_AUTH_SECRET must be set to a cryptographically random string of at least 32 characters.',
    );
  }
}

function corsOrigins(): string[] {
  const raw = process.env.SES_CORS_ORIGINS;
  if (raw?.trim()) {
    return raw
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
  }
  return ['http://127.0.0.1:3210', 'http://localhost:3210'];
}

async function bootstrap() {
  assertProductionSecrets();
  const app = await NestFactory.create(AppModule, { cors: false });
  app.enableCors({
    origin: corsOrigins(),
    credentials: true,
  });
  app.use(cookieParser(process.env.SES_AUTH_SECRET || 'ses-dev-secret'));
  app.use((request: Request, response: Response, next: NextFunction) => {
    const requestId = createRequestId(request.headers['x-request-id']);
    response.setHeader('X-Request-ID', requestId);
    requestContext.run({ requestId }, next);
  });
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  await app.listen(3211, '127.0.0.1');
}

void bootstrap();
