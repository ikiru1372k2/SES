import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import '../src/load-env';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { createRequestId, requestContext } from '../src/common/request-context';

const hasDb = Boolean(process.env.DATABASE_URL);

async function createApp(): Promise<INestApplication> {
  process.env.SES_ALLOW_DEV_LOGIN = 'true';
  process.env.NODE_ENV = process.env.NODE_ENV || 'test';
  const app = await NestFactory.create(AppModule, { logger: false });
  app.use(cookieParser(process.env.SES_AUTH_SECRET || 'ses-dev-secret'));
  app.use((req: Request, res: Response, next: NextFunction) => {
    const requestId = createRequestId(req.headers['x-request-id']);
    res.setHeader('X-Request-ID', requestId);
    requestContext.run({ requestId }, next);
  });
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  await app.init();
  return app;
}

function uniqueEmail(label: string): string {
  return `e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ses.test`;
}

type SignedUpUser = { id: string; email: string; displayName: string; role: string; tenantId: string };

describe('auth API e2e', { skip: !hasDb }, () => {
  let app: INestApplication;

  before(async () => {
    app = await createApp();
  });

  after(async () => {
    await app?.close();
  });

  it('signup success → returns user and sets ses_auth cookie', async () => {
    const email = uniqueEmail('signup-ok');
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ email, displayName: 'Signup OK', password: 'pw12345678', role: 'auditor' })
      .expect(201);
    const user = (res.body as { user: SignedUpUser }).user;
    assert.ok(user.id);
    assert.equal(user.email, email);
    assert.equal(user.role, 'auditor');
    assert.ok(user.tenantId, 'tenantId should be populated for memberless signup');
    const setCookie = res.headers['set-cookie'];
    const cookieHeader = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie ?? '');
    assert.match(cookieHeader, /ses_auth=/);
  });

  it('signup duplicate email → 409', async () => {
    const email = uniqueEmail('dup');
    await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ email, displayName: 'First', password: 'pw12345678', role: 'auditor' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ email, displayName: 'Second', password: 'pw12345678', role: 'auditor' })
      .expect(409);
  });

  it('signup with invalid role → 400', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ email: uniqueEmail('viewer'), displayName: 'No', password: 'pw12345678', role: 'viewer' })
      .expect(400);
  });

  it('signup with short password → 400', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ email: uniqueEmail('short'), displayName: 'Short', password: 'short', role: 'auditor' })
      .expect(400);
  });

  it('login with correct credentials → 201, returns user', async () => {
    const email = uniqueEmail('login-ok');
    await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ email, displayName: 'Login OK', password: 'pw12345678', role: 'auditor' })
      .expect(201);
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'pw12345678' })
      .expect(201);
    const user = (res.body as { user: SignedUpUser }).user;
    assert.equal(user.email, email);
  });

  it('login with wrong password → 401', async () => {
    const email = uniqueEmail('wrong-pw');
    await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ email, displayName: 'Wrong PW', password: 'pw12345678', role: 'auditor' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'not-the-password' })
      .expect(401);
  });

  it('login with unknown email → 401', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: uniqueEmail('unknown'), password: 'pw12345678' })
      .expect(401);
  });

  it('round-trip: signup → logout → login → /auth/me with no memberships', async () => {
    const email = uniqueEmail('round-trip');
    const agent = request.agent(app.getHttpServer());
    const signupRes = await agent
      .post('/api/v1/auth/signup')
      .send({ email, displayName: 'Round Trip', password: 'pw12345678', role: 'auditor' })
      .expect(201);
    const signupUserId = (signupRes.body as { user: SignedUpUser }).user.id;

    await agent.post('/api/v1/auth/logout').expect(201);

    await agent
      .post('/api/v1/auth/login')
      .send({ email, password: 'pw12345678' })
      .expect(201);

    const meRes = await agent.get('/api/v1/auth/me').expect(200);
    const meUser = (meRes.body as { user: SignedUpUser }).user;
    assert.equal(meUser.id, signupUserId);
    assert.ok(meUser.tenantId);
  });
});
