/**
 * Full-stack checks against a real database. Requires `DATABASE_URL`, migrations through
 * issue #69 (tenant + `ManagerDirectory`), and seeded users (`npm run prisma:seed` in apps/api).
 * A 500 on `dev-login` usually means schema drift or a missing default tenant row.
 */
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

describe('directory API e2e', { skip: !hasDb }, () => {
  let app: INestApplication;

  before(async () => {
    app = await createApp();
  });

  after(async () => {
    await app?.close();
  });

  it('admin upload preview → commit → list; auditor cannot mutate', async () => {
    const admin = request.agent(app.getHttpServer());
    const login = await admin.post('/api/v1/auth/dev-login').send({ email: 'admin@ses.local' });
    assert.equal(login.status, 201, `dev-login: ${login.status} ${String(login.text)}`);

    const unique = `e2e-dir-${Date.now()}@ses.local`;
    const up = await admin
      .post('/api/v1/directory/upload')
      .send({
        rows: [{ firstName: 'E2E', lastName: 'Directory', email: unique }],
      })
      .expect(201);
    const body = up.body as { preview?: unknown[]; counts?: { ok?: number } };
    assert.ok(Array.isArray(body.preview));
    assert.equal(body.counts?.ok, 1);

    const commit = await admin
      .post('/api/v1/directory/commit')
      .send({
        rows: [{ firstName: 'E2E', lastName: 'Directory', email: unique }],
        strategy: 'skip_duplicates',
      })
      .expect(201);
    const c = commit.body as { created?: string[] };
    assert.ok(c.created?.length === 1);

    const listed = await admin.get('/api/v1/directory').expect(200);
    const listBody = listed.body as { items?: { email: string }[] };
    assert.ok(listBody.items?.some((e) => e.email.toLowerCase() === unique.toLowerCase()));

    const auditor = request.agent(app.getHttpServer());
    await auditor.post('/api/v1/auth/dev-login').send({ email: 'auditor@ses.local' }).expect(201);
    await auditor
      .post('/api/v1/directory/upload')
      .send({ rows: [{ firstName: 'X', lastName: 'Y', email: 'x@y.com' }] })
      .expect(403);
  });

  it('auditor can call suggestions', async () => {
    const agent = request.agent(app.getHttpServer());
    const login = await agent.post('/api/v1/auth/dev-login').send({ email: 'auditor@ses.local' });
    assert.equal(login.status, 201, `dev-login: ${login.status} ${String(login.text)}`);
    const res = await agent.post('/api/v1/directory/suggestions').send({ rawNames: ['Smith, Jane'] }).expect(201);
    const b = res.body as { results?: Record<string, unknown> };
    assert.ok(b.results && typeof b.results['Smith, Jane'] === 'object');
  });
});
