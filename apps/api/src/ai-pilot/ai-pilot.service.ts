import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ulid } from 'ulid';
import {
  PROMPT_EXAMPLES,
  parseWorkbookBuffer,
  runAiPilotRules,
  validateSpec,
} from '@ses/domain';
import type {
  AiRuleSpec,
  FunctionId,
  IssueCategory,
  Severity,
  SessionUser,
  WorkbookFile,
} from '@ses/domain';
import { PrismaService } from '../common/prisma.service';
import { PgService } from '../db/pg.service';
import {
  ObjectStorageService,
  aiPilotObjectKey,
  sha256Hex,
} from '../object-storage';
import { UploadedObjectsRepository } from '../repositories/uploaded-objects.repository';
import { AiClientService } from './ai-client.service';
import { projectLiteEscalations, type EscalationLitePreview } from './escalation-projector';

const SANDBOX_TTL_HOURS = Number(process.env.AI_PILOT_SANDBOX_TTL_HOURS ?? 24);

@Injectable()
export class AiPilotService {
  private readonly logger = new Logger(AiPilotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiClient: AiClientService,
    private readonly storage: ObjectStorageService,
    private readonly uploadedObjects: UploadedObjectsRepository,
    private readonly pg: PgService,
  ) {}

  /** Stream a sandbox session's uploaded sample bytes from object storage. */
  private async readSessionBytes(sessionId: string): Promise<Buffer> {
    const rows = await this.pg.query<{ uploadedObjectId: string | null; fileBytes: Buffer | null }>(
      `SELECT "uploadedObjectId", "fileBytes" FROM "AiPilotSandboxSession" WHERE "id" = $1`,
      [sessionId],
    );
    const row = rows[0];
    if (!row) throw new NotFoundException(`session ${sessionId} not found`);
    if (row.uploadedObjectId) {
      const meta = await this.uploadedObjects.findById(row.uploadedObjectId);
      if (!meta) throw new NotFoundException(`object ${row.uploadedObjectId} missing`);
      // The bucket name is recorded on the metadata row, so we resolve
      // by exact name (works whether the object lives in ses-ai-files,
      // a legacy single bucket, or a future renamed bucket).
      const stream = await this.storage.getObjectStream(meta.objectKey, {
        bucketName: meta.bucket,
      });
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk as Buffer);
      }
      return Buffer.concat(chunks);
    }
    if (row.fileBytes) return Buffer.from(row.fileBytes);
    throw new NotFoundException(`session ${sessionId} has no payload`);
  }

  // ---------- Engine integration (Phase 1) ----------

  async loadActiveSpecs(functionId: string): Promise<AiRuleSpec[]> {
    try {
      const rows = await this.prisma.auditRule.findMany({
        where: { functionId, source: 'ai-pilot', status: 'active' },
        include: { aiMeta: true },
      });
      const specs: AiRuleSpec[] = [];
      for (const row of rows) {
        if (!row.aiMeta) continue;
        specs.push({
          ruleCode: row.ruleCode,
          ruleVersion: row.version,
          functionId: row.functionId as FunctionId,
          name: row.name,
          category: row.category as IssueCategory,
          severity: row.defaultSeverity as Severity,
          flagMessage: row.aiMeta.flagMessage,
          logic: row.aiMeta.logic as AiRuleSpec['logic'],
        });
      }
      return specs;
    } catch (err) {
      this.logger.error(
        `loadActiveSpecs(${functionId}) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  // ---------- Health ----------

  async health() {
    return this.aiClient.health();
  }

  // ---------- Prompt examples ----------

  getPromptExamples(functionId: FunctionId): string[] {
    return PROMPT_EXAMPLES[functionId] ?? [];
  }

  // ---------- Rule list / detail ----------

  async listRulesForFunction(functionId: FunctionId) {
    const rows = await this.prisma.auditRule.findMany({
      where: { functionId, source: 'ai-pilot' },
      include: { aiMeta: { include: { authoredBy: { select: { displayName: true, email: true } } } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.serializeRule(r));
  }

  async getRule(ruleCode: string) {
    const row = await this.prisma.auditRule.findUnique({
      where: { ruleCode },
      include: { aiMeta: { include: { authoredBy: { select: { displayName: true, email: true } } } } },
    });
    if (!row || row.source !== 'ai-pilot') {
      throw new NotFoundException(`AI rule ${ruleCode} not found`);
    }
    return this.serializeRule(row);
  }

  // ---------- Sandbox: upload sample ----------

  async uploadSample(user: SessionUser, functionId: FunctionId, file: Express.Multer.File) {
    if (!file?.buffer) throw new BadRequestException('file required');
    const buffer = file.buffer;
    const contentType = file.mimetype || 'application/octet-stream';

    let parsed: WorkbookFile;
    try {
      parsed = await parseWorkbookBuffer(buffer, file.originalname);
    } catch (err) {
      throw new BadRequestException(
        `Could not parse workbook: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const sessionId = ulid();
    const expiresAt = new Date(Date.now() + SANDBOX_TTL_HOURS * 3600 * 1000);
    const checksum = sha256Hex(buffer);
    const objectKey = aiPilotObjectKey({
      tenantId: (user as { tenantId?: string }).tenantId ?? 'default',
      sessionId,
      fileName: file.originalname,
    });

    // 1. Reserve metadata row (status=pending) before touching storage so a
    //    crash mid-upload leaves a forensic trail.
    const aiPilotBucket = this.storage.bucketFor('ai-pilot');
    const metadataId = ulid();
    await this.uploadedObjects.createPending({
      id: metadataId,
      tenantId: (user as { tenantId?: string }).tenantId ?? null,
      ownerId: user.id,
      bucket: aiPilotBucket,
      objectKey,
      originalFileName: file.originalname,
      contentType,
      sizeBytes: buffer.length,
      checksumSha256: checksum,
      storageProvider: this.storage.storageProvider,
      storageEndpoint: this.storage.storageEndpoint,
    });

    // 2. Upload bytes to S3-compatible storage. On failure, mark the row.
    try {
      await this.storage.putObject({
        objectKey,
        body: buffer,
        contentType,
        contentLength: buffer.length,
        checksumSha256: checksum,
        bucket: 'ai-pilot',
      });
      await this.uploadedObjects.markUploaded(metadataId);
    } catch (err) {
      await this.uploadedObjects.markFailed(metadataId).catch(() => {});
      this.logger.error(
        `object upload failed sessionId=${sessionId} key=${objectKey} err=${err instanceof Error ? err.message : 'unknown'}`,
      );
      throw new BadRequestException('upload failed');
    }

    // 3. Persist sandbox session pointing at the uploaded object. Bytes are
    //    NOT stored in Postgres — readSessionBytes() streams from storage.
    await this.pg.query(
      `INSERT INTO "AiPilotSandboxSession"
        ("id","authoredById","functionId","fileName","fileBytes","sheetName","expiresAt","uploadedObjectId")
       VALUES ($1,$2,$3,$4,NULL,NULL,$5,$6)`,
      [sessionId, user.id, functionId, file.originalname, expiresAt, metadataId],
    );

    // Best-effort: ask FastAPI for Docling preview markdown. Failure must not block.
    let previewMarkdown: string | undefined;
    try {
      const result = await this.aiClient.uploadForParse(buffer, file.originalname);
      if (result.ok) previewMarkdown = result.data.preview_markdown;
    } catch {
      /* swallow */
    }

    await this.log(user.id, 'sandbox.upload', null, {
      sessionId,
      fileName: file.originalname,
      sheetCount: parsed.sheets.length,
    });

    return {
      sessionId,
      fileName: file.originalname,
      expiresAt: expiresAt.toISOString(),
      sheets: parsed.sheets.map((s) => ({
        name: s.name,
        rowCount: s.rowCount,
        status: s.status,
        // Prefer original headers (real text from the workbook) over
        // normalizedHeaders (canonical SES IDs that include "column23"
        // placeholders for non-canonical columns). The columnResolver
        // can match either, but the LLM needs human-readable names.
        normalizedHeaders: s.originalHeaders?.length
          ? s.originalHeaders
          : s.normalizedHeaders ?? [],
      })),
      previewMarkdown,
    };
  }

  // ---------- Sandbox: pick sheet ----------

  async pickSheet(user: SessionUser, sessionId: string, sheetName: string) {
    const session = await this.requireOwnedSession(user, sessionId);
    await this.prisma.aiPilotSandboxSession.update({
      where: { id: session.id },
      data: { sheetName },
    });
    return { ok: true };
  }

  // ---------- Sandbox: generate ----------

  async generate(user: SessionUser, sessionId: string, prompt: string) {
    const session = await this.requireOwnedSession(user, sessionId);
    const bytes = await this.readSessionBytes(session.id);
    const parsed = await parseWorkbookBuffer(bytes, session.fileName);
    const sheet = session.sheetName
      ? parsed.sheets.find((s) => s.name === session.sheetName)
      : parsed.sheets.find((s) => s.status === 'valid' && s.isSelected);
    // Prefer originalHeaders so the LLM sees real names like "Contractor Type"
    // instead of canonical placeholders like "column23".
    const columns =
      sheet?.originalHeaders?.length
        ? sheet.originalHeaders
        : sheet?.normalizedHeaders ?? [];

    const generated = await this.aiClient.generate({
      prompt,
      columns,
      functionId: session.functionId,
      sessionId,
    });

    await this.log(user.id, 'sandbox.generate', null, {
      sessionId,
      prompt,
      success: generated.success,
    });

    if (!generated.success) {
      return { success: false, raw: generated.raw, error: generated.error };
    }

    // Force the LLM-suggested ruleCode to a fresh ai_<ulid> so we never collide
    // with an existing rule. Force functionId to match the session.
    generated.spec.ruleCode = `ai_${ulid().toLowerCase()}`;
    generated.spec.functionId = session.functionId as FunctionId;
    if (!generated.spec.ruleVersion || generated.spec.ruleVersion < 1) {
      generated.spec.ruleVersion = 1;
    }

    return { success: true, spec: generated.spec, raw: generated.raw };
  }

  // ---------- Sandbox: enhance prompt ----------

  async enhancePrompt(
    user: SessionUser,
    sessionId: string,
    prompt: string,
    columns: string[],
  ) {
    const session = await this.requireOwnedSession(user, sessionId);
    const result = await this.aiClient.enhance({
      prompt,
      columns,
      engine: session.functionId,
      sessionId,
    });
    await this.log(user.id, 'sandbox.enhance', null, {
      sessionId,
      promptLen: prompt.length,
      columnsLen: columns.length,
    });
    return { enhancedPrompt: result.enhancedPrompt };
  }

  // ---------- Sandbox: preview ----------

  async preview(user: SessionUser, sessionId: string, specInput: unknown) {
    const session = await this.requireOwnedSession(user, sessionId);
    const validation = validateSpec(specInput);
    if (!validation.ok) {
      throw new BadRequestException(`Invalid spec: ${validation.error}`);
    }
    const spec = validation.spec;
    if (spec.functionId !== session.functionId) {
      throw new BadRequestException(
        `Spec functionId (${spec.functionId}) doesn't match session functionId (${session.functionId})`,
      );
    }
    const bytes = await this.readSessionBytes(session.id);
    const file = await parseWorkbookBuffer(bytes, session.fileName);
    if (session.sheetName) {
      for (const s of file.sheets) {
        s.isSelected = s.name === session.sheetName && s.status === 'valid';
      }
    }
    const result = runAiPilotRules(file, {
      functionId: spec.functionId,
      rules: [spec],
    });

    await this.log(user.id, 'sandbox.preview', null, {
      sessionId,
      flagged_count: result.flaggedRows,
      scanned_rows: result.scannedRows,
      unknownColumns: result.unknownColumns,
    });

    return result;
  }

  // ---------- Sandbox: preview escalations (lite) ----------

  async previewEscalations(
    user: SessionUser,
    sessionId: string,
    specInput: unknown,
  ): Promise<EscalationLitePreview> {
    const previewResult = await this.preview(user, sessionId, specInput);
    return projectLiteEscalations(this.prisma, user.tenantId ?? '', previewResult.issues);
  }

  // ---------- Sandbox: save (commit to AuditRule + AiPilotRuleMeta) ----------

  async saveRule(
    user: SessionUser,
    specInput: unknown,
    sandboxSessionId: string,
    previewedAt: string,
  ) {
    if (!previewedAt) throw new BadRequestException('previewedAt is required (preview must run before save)');
    const session = await this.requireOwnedSession(user, sandboxSessionId);

    const validation = validateSpec(specInput);
    if (!validation.ok) throw new BadRequestException(`Invalid spec: ${validation.error}`);
    const spec = validation.spec;
    if (spec.functionId !== session.functionId) {
      throw new BadRequestException('functionId mismatch');
    }

    const newRuleCode = spec.ruleCode.startsWith('ai_') ? spec.ruleCode : `ai_${ulid().toLowerCase()}`;

    const persisted = await this.prisma.$transaction(async (tx) => {
      const auditRule = await tx.auditRule.create({
        data: {
          id: ulid(),
          ruleCode: newRuleCode,
          functionId: spec.functionId,
          name: spec.name,
          category: spec.category,
          description: spec.flagMessage,
          defaultSeverity: spec.severity,
          isEnabledDefault: true,
          paramsSchema: {},
          version: spec.ruleVersion,
          source: 'ai-pilot',
          status: 'active',
        },
      });
      const meta = await tx.aiPilotRuleMeta.create({
        data: {
          id: ulid(),
          ruleCode: newRuleCode,
          description: spec.flagMessage,
          logic: spec.logic as object,
          flagMessage: spec.flagMessage,
          authoredById: user.id,
          sourcePrompt: '',
          sourceSessionId: session.id,
        },
      });
      return { auditRule, meta };
    });

    await this.log(user.id, 'rule.save', newRuleCode, {
      sessionId: session.id,
      previewedAt,
      severity: spec.severity,
      category: spec.category,
    });

    return this.serializeRule({
      ...persisted.auditRule,
      aiMeta: { ...persisted.meta, authoredBy: { displayName: user.displayName, email: user.email } },
    });
  }

  // ---------- Manage: pause / resume / archive ----------

  async setStatus(
    user: SessionUser,
    ruleCode: string,
    status: 'active' | 'paused' | 'archived',
  ) {
    const existing = await this.prisma.auditRule.findUnique({ where: { ruleCode } });
    if (!existing || existing.source !== 'ai-pilot') {
      throw new NotFoundException(`AI rule ${ruleCode} not found`);
    }
    const updated = await this.prisma.auditRule.update({
      where: { ruleCode },
      data: { status },
    });
    await this.log(user.id, `rule.${status === 'paused' ? 'pause' : status === 'active' ? 'resume' : 'archive'}`, ruleCode, {
      previousStatus: existing.status,
    });
    return { ruleCode, status: updated.status };
  }

  // ---------- Audit log ----------

  async listAuditLog(opts: { ruleCode?: string; actorId?: string; limit?: number }) {
    return this.prisma.aiPilotAuditLog.findMany({
      where: {
        ...(opts.ruleCode ? { ruleCode: opts.ruleCode } : {}),
        ...(opts.actorId ? { actorId: opts.actorId } : {}),
      },
      include: { actor: { select: { displayName: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(opts.limit ?? 50, 200),
    });
  }

  // ---------- Welcome state ----------

  async getWelcomeState(user: SessionUser) {
    const pref = await this.prisma.userPreference.findUnique({
      where: { userId: user.id },
      select: { data: true },
    });
    const data = (pref?.data ?? {}) as Record<string, unknown>;
    return { aiPilotWelcomeDismissed: data.aiPilotWelcomeDismissed === true };
  }

  async dismissWelcome(user: SessionUser) {
    const pref = await this.prisma.userPreference.findUnique({
      where: { userId: user.id },
    });
    const data = ((pref?.data as Record<string, unknown> | null) ?? {});
    const next = { ...data, aiPilotWelcomeDismissed: true };
    if (pref) {
      await this.prisma.userPreference.update({
        where: { userId: user.id },
        data: { data: next },
      });
    } else {
      await this.prisma.userPreference.create({
        data: { id: ulid(), userId: user.id, data: next },
      });
    }
    return { aiPilotWelcomeDismissed: true };
  }

  // ---------- Internal helpers ----------

  private async requireOwnedSession(user: SessionUser, sessionId: string) {
    const session = await this.prisma.aiPilotSandboxSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException('Sandbox session not found');
    if (session.authoredById !== user.id) throw new NotFoundException('Sandbox session not found');
    if (session.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Sandbox session has expired; please re-upload');
    }
    return session;
  }

  private async log(actorId: string, action: string, ruleCode: string | null, payload: unknown) {
    try {
      await this.prisma.aiPilotAuditLog.create({
        data: {
          id: ulid(),
          actorId,
          action,
          ruleCode,
          payload: payload as object,
        },
      });
    } catch (err) {
      this.logger.warn(`audit log failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private serializeRule(row: {
    ruleCode: string;
    name: string;
    category: string;
    description: string;
    defaultSeverity: string;
    version: number;
    source: string;
    status: string;
    functionId: string;
    createdAt: Date;
    aiMeta: {
      description: string;
      logic: unknown;
      flagMessage: string;
      sourcePrompt: string;
      authoredBy?: { displayName: string; email: string } | null;
      createdAt: Date;
      updatedAt: Date;
    } | null;
  }) {
    return {
      ruleCode: row.ruleCode,
      name: row.name,
      functionId: row.functionId,
      category: row.category,
      severity: row.defaultSeverity,
      status: row.status,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      aiMeta: row.aiMeta
        ? {
            description: row.aiMeta.description,
            flagMessage: row.aiMeta.flagMessage,
            logic: row.aiMeta.logic,
            authoredBy: row.aiMeta.authoredBy ?? null,
            createdAt: row.aiMeta.createdAt.toISOString(),
            updatedAt: row.aiMeta.updatedAt.toISOString(),
          }
        : null,
    };
  }
}
