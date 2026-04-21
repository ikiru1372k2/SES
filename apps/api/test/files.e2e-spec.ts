import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import ExcelJS from 'exceljs';
import request from 'supertest';
import '../src/load-env';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { createRequestId, requestContext } from '../src/common/request-context';

const hasDb = Boolean(process.env.DATABASE_URL);

async function minimalXlsxBuffer(): Promise<Buffer> {
  const rows = [
    ['QGC effort planning review'],
    ['Country', 'Business Unit (Project)', 'Customer Name', 'Project No.', 'Project', 'Project State', 'Project Manager', 'Email', 'Effort (H)'],
    ['100', 'Digital Transformation', 'Siemens AG', '90032101', 'Digital Core SAP S4', 'Authorised', 'Muller, Hans', 'h.muller@company.com', 920],
  ];
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('Effort Data').addRows(rows);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

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

describe('files API e2e', { skip: !hasDb }, () => {
  let app: INestApplication;

  before(async () => {
    app = await createApp();
  });

  after(async () => {
    await app?.close();
  });

  it('upload → list → download → version → draft → promote (cookie auth)', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/v1/auth/dev-login').send({ email: 'auditor@ses.local' }).expect(201);

    const created = await agent.post('/api/v1/processes').send({ name: 'e2e-files-lifecycle', description: '' }).expect(201);
    const processId = (created.body as { id?: string }).id;
    assert.ok(processId);

    const buf = await minimalXlsxBuffer();
    const up = await agent
      .post(`/api/v1/processes/${encodeURIComponent(processId)}/functions/over-planning/files`)
      .attach('file', buf, { filename: 'book.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      .expect(201);
    const fileId = (up.body as { id?: string }).id;
    assert.ok(fileId);

    const listed = await agent
      .get(`/api/v1/processes/${encodeURIComponent(processId)}/functions/over-planning/files`)
      .expect(200);
    assert.ok(Array.isArray(listed.body));
    assert.ok((listed.body as { id: string }[]).some((f) => f.id === fileId));

    const dl = await agent.get(`/api/v1/files/${encodeURIComponent(fileId)}/download`).buffer(true).parse((res, cb) => {
      const data: Buffer[] = [];
      res.on('data', (c: Buffer) => data.push(c));
      res.on('end', () => cb(null, Buffer.concat(data)));
    });
    assert.equal(dl.status, 200);
    assert.ok(Buffer.isBuffer(dl.body));
    assert.ok((dl.body as Buffer).byteLength > 0);

    const ver = await agent.post(`/api/v1/files/${encodeURIComponent(fileId)}/versions`).send({ note: 'e2e v' }).expect(201);
    const versionNumber = (ver.body as { versionNumber?: number }).versionNumber;
    assert.ok(versionNumber && versionNumber >= 1);

    const dlVer = await agent
      .get(`/api/v1/files/${encodeURIComponent(fileId)}/versions/${versionNumber}/download`)
      .buffer(true)
      .parse((res, cb) => {
        const data: Buffer[] = [];
        res.on('data', (c: Buffer) => data.push(c));
        res.on('end', () => cb(null, Buffer.concat(data)));
      });
    assert.equal(dlVer.status, 200);

    const draftBuf = await minimalXlsxBuffer();
    await agent
      .put(`/api/v1/processes/${encodeURIComponent(processId)}/functions/over-planning/draft`)
      .attach('file', draftBuf, { filename: 'draft.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      .expect(200);

    await agent
      .post(`/api/v1/processes/${encodeURIComponent(processId)}/functions/over-planning/draft/promote`)
      .send({})
      .expect(201);
  });

  it('rejects non-xlsx magic with 415', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/v1/auth/dev-login').send({ email: 'auditor@ses.local' }).expect(201);
    const created = await agent.post('/api/v1/processes').send({ name: 'e2e-415', description: '' }).expect(201);
    const processId = (created.body as { id: string }).id;
    const bad = Buffer.from('this is not an xlsx file content');
    const res = await agent
      .post(`/api/v1/processes/${encodeURIComponent(processId)}/functions/over-planning/files`)
      .attach('file', bad, { filename: 'fake.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    assert.equal(res.status, 415);
  });

  it('returns 403 when user is not a process member', async () => {
    const auditor = request.agent(app.getHttpServer());
    await auditor.post('/api/v1/auth/dev-login').send({ email: 'auditor@ses.local' }).expect(201);
    const created = await auditor.post('/api/v1/processes').send({ name: 'e2e-member-only', description: '' }).expect(201);
    const processId = (created.body as { id: string }).id;

    const admin = request.agent(app.getHttpServer());
    await admin.post('/api/v1/auth/dev-login').send({ email: 'admin@ses.local' }).expect(201);
    const res = await admin.get(`/api/v1/processes/${encodeURIComponent(processId)}`);
    assert.equal(res.status, 403);
  });
});
