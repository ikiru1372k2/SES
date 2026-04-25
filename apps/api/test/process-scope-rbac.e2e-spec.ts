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

function freshEmail(label: string): string {
  return `scope-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ses.test`;
}

async function signup(server: ReturnType<INestApplication['getHttpServer']>, email: string) {
  const agent = request.agent(server);
  // The global ThrottlerGuard (400 req/min) can fire late in the e2e suite
  // because every prior test contributes to the same window. Retry briefly
  // on 429 so legitimate signups don't fail the suite.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const res = await agent
      .post('/api/v1/auth/signup')
      .send({ email, displayName: email.split('@')[0], password: 'pw12345678', role: 'auditor' });
    if (res.status === 201) return agent;
    if (res.status !== 429) {
      throw new Error(`signup failed for ${email}: status=${res.status} body=${JSON.stringify(res.body)}`);
    }
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  throw new Error(`signup repeatedly throttled for ${email}`);
}

describe('process-scope RBAC e2e', { skip: !hasDb }, () => {
  let app: INestApplication;
  // One owner is reused across most tests so we don't burn through the global
  // 400-req/min throttle quota on extra signups + logins. Each test still
  // creates its own process and (where needed) a fresh member.
  let owner: ReturnType<typeof request.agent>;

  before(async () => {
    app = await createApp();
    owner = await signup(app.getHttpServer(), freshEmail('owner-shared'));
  });

  after(async () => {
    await app?.close();
  });

  it('member without scope rows behaves like before (legacy fallback)', async () => {
    const server = app.getHttpServer();
    const memberEmail = freshEmail('member-legacy');
    await signup(server, memberEmail);

    const created = await owner.post('/api/v1/processes').send({ name: 'rbac-legacy', description: '' }).expect(201);
    const processId = (created.body as { id: string }).id;

    // Invite as plain editor, no scopes — must keep behaving like before.
    await owner
      .post(`/api/v1/processes/${encodeURIComponent(processId)}/members`)
      .send({ email: memberEmail, permission: 'editor' })
      .expect(201);

    const memberAgent = await signup(server, memberEmail).catch(async () => {
      // signup will 409 because the user already exists; fall back to login.
      const a = request.agent(server);
      await a.post('/api/v1/auth/login').send({ email: memberEmail, password: 'pw12345678' }).expect(201);
      return a;
    });

    // Plain editor → can list files for any function.
    await memberAgent
      .get(`/api/v1/processes/${encodeURIComponent(processId)}/functions/master-data/files`)
      .expect(200);
  });

  it('scoped function viewer can view that function but not edit, and cannot view other functions', async () => {
    const server = app.getHttpServer();
    const memberEmail = freshEmail('member-scope-view');
    await signup(server, memberEmail);

    const created = await owner.post('/api/v1/processes').send({ name: 'rbac-fn-view', description: '' }).expect(201);
    const processId = (created.body as { id: string }).id;

    await owner
      .post(`/api/v1/processes/${encodeURIComponent(processId)}/members`)
      .send({
        email: memberEmail,
        permission: 'viewer',
        accessMode: 'scoped',
        scopes: [{ scopeType: 'function', functionId: 'master-data', accessLevel: 'viewer' }],
      })
      .expect(201);

    const member = request.agent(server);
    await member.post('/api/v1/auth/login').send({ email: memberEmail, password: 'pw12345678' }).expect(201);

    // Allowed: GET on the scoped function.
    await member
      .get(`/api/v1/processes/${encodeURIComponent(processId)}/functions/master-data/files`)
      .expect(200);

    // Denied: GET on a different function.
    await member
      .get(`/api/v1/processes/${encodeURIComponent(processId)}/functions/over-planning/files`)
      .expect(403);

    // Denied: edit even on the scoped function (viewer level).
    const draftRes = await member
      .put(`/api/v1/processes/${encodeURIComponent(processId)}/functions/master-data/draft`)
      .attach('file', Buffer.from('not-a-file'), { filename: 'x.xlsx' });
    // Either 403 (scope deny) or 415 (file rejection) is acceptable proof
    // the route ran; the scope deny short-circuits before the upload pipe.
    assert.ok([403, 415].includes(draftRes.status), `expected 403/415, got ${draftRes.status}`);
    if (draftRes.status === 415) {
      // If the route accepted the request past the guard then scope passed —
      // that would be a bug. Fail explicitly.
      assert.fail('viewer scope unexpectedly allowed an edit route');
    }
  });

  it('escalation-only viewer can hit /escalations but not function file routes', async () => {
    const server = app.getHttpServer();
    const memberEmail = freshEmail('member-esc');
    await signup(server, memberEmail);

    const created = await owner.post('/api/v1/processes').send({ name: 'rbac-esc', description: '' }).expect(201);
    const processId = (created.body as { id: string }).id;

    await owner
      .post(`/api/v1/processes/${encodeURIComponent(processId)}/members`)
      .send({
        email: memberEmail,
        permission: 'viewer',
        accessMode: 'scoped',
        scopes: [{ scopeType: 'escalation-center', accessLevel: 'viewer' }],
      })
      .expect(201);

    const member = request.agent(server);
    await member.post('/api/v1/auth/login').send({ email: memberEmail, password: 'pw12345678' }).expect(201);

    await member
      .get(`/api/v1/processes/${encodeURIComponent(processId)}/escalations`)
      .expect(200);

    await member
      .get(`/api/v1/processes/${encodeURIComponent(processId)}/functions/master-data/files`)
      .expect(403);
  });

  it('owner is not affected by scope rows', async () => {
    // Re-use the shared owner; create a fresh process under them.
    const created = await owner.post('/api/v1/processes').send({ name: 'rbac-owner', description: '' }).expect(201);
    const processId = (created.body as { id: string }).id;

    // Owner can hit any function & escalations regardless of scope rows.
    await owner
      .get(`/api/v1/processes/${encodeURIComponent(processId)}/functions/over-planning/files`)
      .expect(200);
    await owner
      .get(`/api/v1/processes/${encodeURIComponent(processId)}/escalations`)
      .expect(200);
  });

  it('rejects invalid scope payloads', async () => {
    const server = app.getHttpServer();
    const memberEmail = freshEmail('member-bad');
    await signup(server, memberEmail);

    const created = await owner.post('/api/v1/processes').send({ name: 'rbac-bad', description: '' }).expect(201);
    const processId = (created.body as { id: string }).id;

    // Function scope without functionId.
    await owner
      .post(`/api/v1/processes/${encodeURIComponent(processId)}/members`)
      .send({
        email: memberEmail,
        permission: 'viewer',
        accessMode: 'scoped',
        scopes: [{ scopeType: 'function', accessLevel: 'viewer' }],
      })
      .expect(400);

    // Non-function scope with a functionId attached.
    await owner
      .post(`/api/v1/processes/${encodeURIComponent(processId)}/members`)
      .send({
        email: memberEmail,
        permission: 'viewer',
        accessMode: 'scoped',
        scopes: [{ scopeType: 'all-functions', functionId: 'master-data', accessLevel: 'viewer' }],
      })
      .expect(400);

    // accessMode='scoped' with no scopes.
    await owner
      .post(`/api/v1/processes/${encodeURIComponent(processId)}/members`)
      .send({
        email: memberEmail,
        permission: 'viewer',
        accessMode: 'scoped',
        scopes: [],
      })
      .expect(400);
  });

  it('GET :id/me/access returns the current user permission + scope rows', async () => {
    const server = app.getHttpServer();
    const memberEmail = freshEmail('member-meaccess');
    await signup(server, memberEmail);

    const created = await owner.post('/api/v1/processes').send({ name: 'rbac-me-access', description: '' }).expect(201);
    const processId = (created.body as { id: string }).id;

    // Owner sees their own access — permission='owner', no scopes.
    const ownerAccess = await owner
      .get(`/api/v1/processes/${encodeURIComponent(processId)}/me/access`)
      .expect(200);
    assert.equal((ownerAccess.body as { permission: string }).permission, 'owner');

    // Add a member with a function:viewer scope.
    await owner
      .post(`/api/v1/processes/${encodeURIComponent(processId)}/members`)
      .send({
        email: memberEmail,
        permission: 'editor',
        accessMode: 'scoped',
        scopes: [{ scopeType: 'function', functionId: 'master-data', accessLevel: 'viewer' }],
      })
      .expect(201);

    const member = request.agent(server);
    await member.post('/api/v1/auth/login').send({ email: memberEmail, password: 'pw12345678' }).expect(201);

    const memberAccess = await member
      .get(`/api/v1/processes/${encodeURIComponent(processId)}/me/access`)
      .expect(200);
    type AccessBody = {
      permission: string;
      scopes: { scopeType: string; functionId: string | null; accessLevel: string }[];
    };
    const body = memberAccess.body as AccessBody;
    assert.equal(body.permission, 'editor');
    assert.equal(body.scopes.length, 1);
    assert.equal(body.scopes[0]!.scopeType, 'function');
    assert.equal(body.scopes[0]!.functionId, 'master-data');
    assert.equal(body.scopes[0]!.accessLevel, 'viewer');

    // Non-member is rejected (defense-in-depth: findAccessibleProcessOrThrow).
    const stranger = request.agent(server);
    const strangerEmail = freshEmail('stranger');
    await signup(server, strangerEmail);
    await stranger.post('/api/v1/auth/login').send({ email: strangerEmail, password: 'pw12345678' }).expect(201);
    await stranger
      .get(`/api/v1/processes/${encodeURIComponent(processId)}/me/access`)
      .expect(403);
  });

  it('function-viewer cannot POST audit/run on the scoped function (controller pre-flight)', async () => {
    const server = app.getHttpServer();
    const memberEmail = freshEmail('member-audit-run');
    await signup(server, memberEmail);

    const created = await owner.post('/api/v1/processes').send({ name: 'rbac-audit-run', description: '' }).expect(201);
    const processId = (created.body as { id: string }).id;

    // Owner uploads a real xlsx file under master-data.
    const buf = await minimalXlsxBuffer();
    const up = await owner
      .post(`/api/v1/processes/${encodeURIComponent(processId)}/functions/master-data/files`)
      .attach('file', buf, { filename: 'book.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      .expect(201);
    const fileId = (up.body as { id: string }).id;

    // Add member as function:viewer on master-data.
    await owner
      .post(`/api/v1/processes/${encodeURIComponent(processId)}/members`)
      .send({
        email: memberEmail,
        permission: 'editor',
        accessMode: 'scoped',
        scopes: [{ scopeType: 'function', functionId: 'master-data', accessLevel: 'viewer' }],
      })
      .expect(201);

    const member = request.agent(server);
    await member.post('/api/v1/auth/login').send({ email: memberEmail, password: 'pw12345678' }).expect(201);

    // Function-viewer should be denied at the controller pre-flight.
    await member
      .post(`/api/v1/processes/${encodeURIComponent(processId)}/audit/run`)
      .send({ fileIdOrCode: fileId })
      .expect(403);
  });

  it('PATCH updates scopes; deleting member cascades scope rows', async () => {
    const server = app.getHttpServer();
    const memberEmail = freshEmail('member-patch');
    await signup(server, memberEmail);

    const created = await owner.post('/api/v1/processes').send({ name: 'rbac-patch', description: '' }).expect(201);
    const processId = (created.body as { id: string }).id;

    const addRes = await owner
      .post(`/api/v1/processes/${encodeURIComponent(processId)}/members`)
      .send({
        email: memberEmail,
        permission: 'viewer',
        accessMode: 'scoped',
        scopes: [{ scopeType: 'function', functionId: 'master-data', accessLevel: 'viewer' }],
      })
      .expect(201);
    const memberCode = (addRes.body as { displayCode: string }).displayCode;

    // Promote scope to editor via PATCH.
    await owner
      .patch(`/api/v1/processes/${encodeURIComponent(processId)}/members/${encodeURIComponent(memberCode)}`)
      .send({
        accessMode: 'scoped',
        scopes: [{ scopeType: 'function', functionId: 'master-data', accessLevel: 'editor' }],
      })
      .expect(200);

    // List should reflect the new scope.
    const listed = await owner.get(`/api/v1/processes/${encodeURIComponent(processId)}/members`).expect(200);
    type Row = { displayCode: string; scopes: { scopeType: string; functionId: string | null; accessLevel: string }[] };
    const memberRow = (listed.body as Row[]).find((r) => r.displayCode === memberCode);
    assert.ok(memberRow);
    assert.equal(memberRow!.scopes.length, 1);
    assert.equal(memberRow!.scopes[0]!.accessLevel, 'editor');

    // Delete — list should drop the member; FK cascade removes scope rows.
    await owner
      .delete(`/api/v1/processes/${encodeURIComponent(processId)}/members/${encodeURIComponent(memberCode)}`)
      .expect(200);
    const listed2 = await owner.get(`/api/v1/processes/${encodeURIComponent(processId)}/members`).expect(200);
    assert.ok(!(listed2.body as Row[]).some((r) => r.displayCode === memberCode));
  });
});
