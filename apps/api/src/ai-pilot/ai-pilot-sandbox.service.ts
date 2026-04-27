import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ulid } from 'ulid';
import { parseWorkbookBuffer, runAiPilotRules, validateSpec } from '@ses/domain';
import type { FunctionId, SessionUser } from '@ses/domain';
import { PrismaService } from '../common/prisma.service';
import { AiClientService } from './ai-client.service';
import { requireOwnedSession } from './ai-pilot-session.helpers';
import { projectLiteEscalations, type EscalationLitePreview } from './escalation-projector';

@Injectable()
export class AiPilotSandboxService {
  private readonly logger = new Logger(AiPilotSandboxService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiClient: AiClientService,
  ) {}

  async uploadSample(user: SessionUser, functionId: FunctionId, file: Express.Multer.File) {
    if (!file?.buffer) throw new BadRequestException('file required');
    const buffer = file.buffer;

    let parsed: Awaited<ReturnType<typeof parseWorkbookBuffer>>;
    try {
      parsed = await parseWorkbookBuffer(buffer, file.originalname);
    } catch (err) {
      throw new BadRequestException(
        `Could not parse workbook: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const sessionId = ulid();
    const expiresAt = new Date(Date.now() + Number(process.env.AI_PILOT_SANDBOX_TTL_HOURS ?? 24) * 3600 * 1000);
    await this.prisma.aiPilotSandboxSession.create({
      data: {
        id: sessionId,
        authoredById: user.id,
        functionId,
        fileName: file.originalname,
        fileBytes: new Uint8Array(buffer),
        expiresAt,
      },
    });

    let previewMarkdown: string | undefined;
    try {
      const result = await this.aiClient.uploadForParse(buffer, file.originalname);
      if (result.ok) previewMarkdown = result.data.preview_markdown;
    } catch {
      /* best-effort — failure must not block the response */
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
        // Prefer originalHeaders (real names) over normalizedHeaders (canonical SES IDs)
        normalizedHeaders: s.originalHeaders?.length ? s.originalHeaders : (s.normalizedHeaders ?? []),
      })),
      previewMarkdown,
    };
  }

  async pickSheet(user: SessionUser, sessionId: string, sheetName: string) {
    const session = await requireOwnedSession(this.prisma, user, sessionId);
    await this.prisma.aiPilotSandboxSession.update({ where: { id: session.id }, data: { sheetName } });
    return { ok: true };
  }

  async generate(user: SessionUser, sessionId: string, prompt: string) {
    const session = await requireOwnedSession(this.prisma, user, sessionId);
    const parsed = await parseWorkbookBuffer(Buffer.from(session.fileBytes), session.fileName);
    const sheet = session.sheetName
      ? parsed.sheets.find((s) => s.name === session.sheetName)
      : parsed.sheets.find((s) => s.status === 'valid' && s.isSelected);
    const columns = sheet?.originalHeaders?.length ? sheet.originalHeaders : (sheet?.normalizedHeaders ?? []);

    const generated = await this.aiClient.generate({
      prompt,
      columns,
      functionId: session.functionId,
      sessionId,
    });

    await this.log(user.id, 'sandbox.generate', null, { sessionId, prompt, success: generated.success });

    if (!generated.success) return { success: false, raw: generated.raw, error: generated.error };

    // Force a fresh ai_<ulid> so we never collide with an existing rule.
    generated.spec.ruleCode = `ai_${ulid().toLowerCase()}`;
    generated.spec.functionId = session.functionId as FunctionId;
    if (!generated.spec.ruleVersion || generated.spec.ruleVersion < 1) generated.spec.ruleVersion = 1;

    return { success: true, spec: generated.spec, raw: generated.raw };
  }

  async enhancePrompt(user: SessionUser, sessionId: string, prompt: string, columns: string[]) {
    const session = await requireOwnedSession(this.prisma, user, sessionId);
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

  async preview(user: SessionUser, sessionId: string, specInput: unknown) {
    const session = await requireOwnedSession(this.prisma, user, sessionId);
    const validation = validateSpec(specInput);
    if (!validation.ok) throw new BadRequestException(`Invalid spec: ${validation.error}`);
    const spec = validation.spec;
    if (spec.functionId !== session.functionId) {
      throw new BadRequestException(
        `Spec functionId (${spec.functionId}) doesn't match session functionId (${session.functionId})`,
      );
    }
    const file = await parseWorkbookBuffer(Buffer.from(session.fileBytes), session.fileName);
    if (session.sheetName) {
      for (const s of file.sheets) {
        s.isSelected = s.name === session.sheetName && s.status === 'valid';
      }
    }
    const result = runAiPilotRules(file, { functionId: spec.functionId, rules: [spec] });

    await this.log(user.id, 'sandbox.preview', null, {
      sessionId,
      flagged_count: result.flaggedRows,
      scanned_rows: result.scannedRows,
      unknownColumns: result.unknownColumns,
    });

    return result;
  }

  async previewEscalations(
    user: SessionUser,
    sessionId: string,
    specInput: unknown,
  ): Promise<EscalationLitePreview> {
    const previewResult = await this.preview(user, sessionId, specInput);
    return projectLiteEscalations(this.prisma, user.tenantId ?? '', previewResult.issues);
  }

  private async log(actorId: string, action: string, ruleCode: string | null, payload: unknown) {
    try {
      await this.prisma.aiPilotAuditLog.create({
        data: { id: ulid(), actorId, action, ruleCode, payload: payload as object },
      });
    } catch (err) {
      this.logger.warn(`audit log failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
