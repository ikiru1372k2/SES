import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import type { Response } from 'express';
import {
  FUNCTION_REGISTRY,
  freshnessForFunction,
  type FunctionId,
  type SessionUser,
} from '@ses/domain';
import { PrismaService } from '../common/prisma.service';
import { ProcessAccessService } from '../common/process-access.service';
import { ChatCacheService } from './chat-cache.service';
import { ChatAuditService } from './chat-audit.service';

const AI_SERVICE_URL = process.env.AI_SERVICE_URL ?? 'http://localhost:8000';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly processAccess: ProcessAccessService,
    private readonly http: HttpService,
    private readonly cache: ChatCacheService,
    private readonly audit: ChatAuditService,
  ) {}

  /** GET /analytics/health → Ollama up/down + loaded models. */
  async health() {
    try {
      const res = await firstValueFrom(
        this.http.get(`${AI_SERVICE_URL}/analytics/health`, { timeout: 3_000 }),
      );
      return res.data;
    } catch (err) {
      return { ok: false, ollama: 'down', loaded_models: [], error: (err as Error).message };
    }
  }

  /** GET /analytics/summary — KPI tiles. */
  async summary(processCode: string, user: SessionUser, functionId?: FunctionId) {
    const process = await this.processAccess.findAccessibleProcessOrThrow(user, processCode, 'viewer');
    const now = Date.now();

    const targets = functionId
      ? FUNCTION_REGISTRY.filter((f) => f.id === functionId)
      : FUNCTION_REGISTRY;

    const perFunction = await Promise.all(
      targets.map(async (fn) => {
        const run = await this.prisma.auditRun.findFirst({
          where: {
            processId: process.id,
            file: { functionId: fn.id },
            OR: [{ status: 'completed' }, { completedAt: { not: null } }],
          },
          orderBy: [{ completedAt: { sort: 'desc', nulls: 'last' } }, { startedAt: 'desc' }],
          select: {
            id: true,
            scannedRows: true,
            flaggedRows: true,
            completedAt: true,
            startedAt: true,
          },
        });
        const completedAt = run?.completedAt ?? run?.startedAt ?? null;
        const ageDays = completedAt
          ? Math.round((now - new Date(completedAt).getTime()) / 86_400_000)
          : null;
        const stale = ageDays !== null && ageDays > freshnessForFunction(fn.id as FunctionId);
        return {
          functionId: fn.id,
          label: fn.label,
          present: !!run,
          scannedRows: run?.scannedRows ?? 0,
          flaggedRows: run?.flaggedRows ?? 0,
          completedAt: completedAt?.toISOString?.() ?? null,
          ageDays,
          stale,
        };
      }),
    );

    const present = perFunction.filter((p) => p.present);
    return {
      processCode: process.displayCode,
      functionId: functionId ?? null,
      totalScanned: present.reduce((s, p) => s + p.scannedRows, 0),
      totalFlagged: present.reduce((s, p) => s + p.flaggedRows, 0),
      functionsCovered: present.length,
      perFunction,
    };
  }

  /** GET /analytics/timeseries — version-by-version trend. */
  async timeseries(processCode: string, user: SessionUser, functionId?: FunctionId) {
    const process = await this.processAccess.findAccessibleProcessOrThrow(user, processCode, 'viewer');

    const versions = await this.prisma.savedVersion.findMany({
      where: {
        processId: process.id,
        ...(functionId ? { auditRun: { file: { functionId } } } : {}),
      },
      orderBy: { versionNumber: 'asc' },
      select: {
        versionNumber: true,
        versionName: true,
        displayCode: true,
        createdAt: true,
        auditRun: {
          select: {
            scannedRows: true,
            flaggedRows: true,
            file: { select: { functionId: true } },
          },
        },
      },
    });

    return versions.map((v) => ({
      versionNumber: v.versionNumber,
      versionName: v.versionName,
      displayCode: v.displayCode,
      createdAt: (v.createdAt as Date).toISOString?.() ?? String(v.createdAt),
      functionId: v.auditRun.file.functionId,
      scannedRows: v.auditRun.scannedRows,
      flaggedRows: v.auditRun.flaggedRows,
    }));
  }

  /** GET /analytics/managers — top managers by issue count. */
  async managers(processCode: string, user: SessionUser, functionId?: FunctionId) {
    const process = await this.processAccess.findAccessibleProcessOrThrow(user, processCode, 'viewer');
    const targets = functionId
      ? FUNCTION_REGISTRY.filter((f) => f.id === functionId)
      : FUNCTION_REGISTRY;

    const issues: Array<{ projectManager: string | null; severity: string; engineId: string }> = [];
    for (const fn of targets) {
      const run = await this.prisma.auditRun.findFirst({
        where: {
          processId: process.id,
          file: { functionId: fn.id },
          OR: [{ status: 'completed' }, { completedAt: { not: null } }],
        },
        orderBy: [{ completedAt: { sort: 'desc', nulls: 'last' } }, { startedAt: 'desc' }],
        select: {
          issues: { select: { projectManager: true, severity: true } },
        },
      });
      if (!run) continue;
      for (const i of run.issues) {
        issues.push({ projectManager: i.projectManager, severity: i.severity, engineId: fn.id });
      }
    }
    const counts = new Map<string, { manager: string; count: number; high: number }>();
    for (const i of issues) {
      const key = (i.projectManager ?? 'Unassigned').trim() || 'Unassigned';
      const cur = counts.get(key) ?? { manager: key, count: 0, high: 0 };
      cur.count += 1;
      if (i.severity === 'High') cur.high += 1;
      counts.set(key, cur);
    }
    return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 20);
  }

  /** GET /analytics/anomalies — rules-led, ML overlay reserved for Phase 4. */
  async anomalies(processCode: string, user: SessionUser, functionId?: FunctionId) {
    const process = await this.processAccess.findAccessibleProcessOrThrow(user, processCode, 'viewer');
    const targets = functionId
      ? FUNCTION_REGISTRY.filter((f) => f.id === functionId)
      : FUNCTION_REGISTRY;

    const ruleViolations: Array<{
      kind: string;
      rule: 'rule';
      ruleId: string | null;
      projectNo: string | null;
      projectName: string | null;
      managerName: string | null;
      severity: string;
      reason: string | null;
      functionId: string;
    }> = [];
    for (const fn of targets) {
      const run = await this.prisma.auditRun.findFirst({
        where: {
          processId: process.id,
          file: { functionId: fn.id },
          OR: [{ status: 'completed' }, { completedAt: { not: null } }],
        },
        orderBy: [{ completedAt: { sort: 'desc', nulls: 'last' } }, { startedAt: 'desc' }],
        select: {
          issues: {
            where: { severity: 'High' },
            select: {
              ruleCode: true,
              projectNo: true,
              projectName: true,
              projectManager: true,
              severity: true,
              reason: true,
            },
            take: 50,
          },
        },
      });
      if (!run) continue;
      for (const i of run.issues) {
        ruleViolations.push({
          kind: 'rule_violation',
          rule: 'rule',
          ruleId: i.ruleCode,
          projectNo: i.projectNo,
          projectName: i.projectName,
          managerName: i.projectManager,
          severity: i.severity,
          reason: i.reason,
          functionId: fn.id,
        });
      }
    }
    return {
      ruleViolations,
      mlOverlay: [], // Phase 4: IsolationForest results
    };
  }

  /** Build the row payload sent to the sidecar. */
  private async buildRows(
    processCode: string,
    user: SessionUser,
    functionId?: FunctionId,
    versionRef?: string,
  ): Promise<{ rows: Array<Record<string, unknown>>; datasetVersion: string }> {
    const process = await this.processAccess.findAccessibleProcessOrThrow(user, processCode, 'viewer');
    const targets = functionId
      ? FUNCTION_REGISTRY.filter((f) => f.id === functionId)
      : FUNCTION_REGISTRY;

    const rows: Array<Record<string, unknown>> = [];
    for (const fn of targets) {
      // If versionRef is set AND scope is single-function, pull the saved version's run.
      const run = versionRef && functionId
        ? await this.prisma.auditRun.findFirst({
            where: {
              processId: process.id,
              file: { functionId: fn.id },
              savedVersions: { some: { OR: [{ id: versionRef }, { displayCode: versionRef }] } },
            },
            select: {
              displayCode: true,
              completedAt: true,
              issues: {
                select: {
                  issueKey: true,
                  ruleCode: true,
                  projectNo: true,
                  projectName: true,
                  projectManager: true,
                  email: true,
                  severity: true,
                  reason: true,
                  effort: true,
                  rowIndex: true,
                  sheetName: true,
                  projectState: true,
                },
              },
            },
          } as any)
        : await this.prisma.auditRun.findFirst({
            where: {
              processId: process.id,
              file: { functionId: fn.id },
              OR: [{ status: 'completed' }, { completedAt: { not: null } }],
            },
            orderBy: [{ completedAt: { sort: 'desc', nulls: 'last' } }, { startedAt: 'desc' }],
            select: {
              displayCode: true,
              completedAt: true,
              issues: {
                select: {
                  issueKey: true,
                  ruleCode: true,
                  projectNo: true,
                  projectName: true,
                  projectManager: true,
                  email: true,
                  severity: true,
                  reason: true,
                  effort: true,
                  rowIndex: true,
                  sheetName: true,
                  projectState: true,
                },
              },
            },
          });
      if (!run) continue;
      for (const i of run.issues) {
        rows.push({ ...i, engineId: fn.id, runCode: run.displayCode });
      }
    }
    const datasetVersion = versionRef ?? `latest:${process.displayCode}:${functionId ?? 'process'}`;
    return { rows, datasetVersion };
  }

  /** POST /analytics/chat → SSE proxy to sidecar with cache + audit. */
  async streamChat(
    processCode: string,
    user: SessionUser,
    body: {
      question: string;
      functionId?: FunctionId;
      versionRef?: string;
      compareTo?: string;
      useStub?: boolean;
    },
    res: Response,
  ): Promise<void> {
    const started = Date.now();
    const { rows, datasetVersion } = await this.buildRows(
      processCode,
      user,
      body.functionId,
      body.versionRef,
    );

    const cacheKey = this.cache.key({
      question: body.question,
      processCode,
      functionId: body.functionId ?? null,
      datasetVersion,
    });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const cached = this.cache.get(cacheKey);
    if (cached) {
      res.write(`data: ${JSON.stringify({ type: 'thinking', text: '(cached answer)' })}\n\n`);
      res.write(`data: ${JSON.stringify(cached)}\n\n`);
      res.end();
      void this.audit.append({
        userId: user.id,
        processCode,
        functionId: body.functionId ?? null,
        versionRef: body.versionRef ?? null,
        question: body.question,
        finalAnswer: (cached as any).answer ?? '',
        chartSpec: (cached as any).chart_spec ?? null,
        modelName: 'cache',
        modelDigest: null,
        latencyMs: Date.now() - started,
        toolCalls: [],
        generatedSql: (cached as any).generated_sql ?? null,
        resultHash: (cached as any).result_hash ?? null,
      });
      return;
    }

    let lastFinal: any = null;
    const toolCalls: unknown[] = [];

    try {
      const upstream = await firstValueFrom(
        this.http.post(
          `${AI_SERVICE_URL}/analytics/chat`,
          {
            process_code: processCode,
            function_id: body.functionId ?? null,
            version_ref: body.versionRef ?? null,
            compare_to: body.compareTo ?? null,
            question: body.question,
            rows,
            use_stub: body.useStub ?? true,
          },
          { responseType: 'stream', timeout: 120_000 },
        ),
      );
      const stream = upstream.data as NodeJS.ReadableStream;

      let buf = '';
      stream.on('data', (chunk: Buffer) => {
        buf += chunk.toString('utf8');
        let idx: number;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          if (!line.startsWith('data:')) continue;
          const json = line.slice(5).trim();
          try {
            const parsed = JSON.parse(json);
            if (parsed.type === 'final') lastFinal = parsed;
            if (parsed.type === 'tool_call') toolCalls.push(parsed);
            res.write(`data: ${JSON.stringify(parsed)}\n\n`);
          } catch {
            res.write(`data: ${json}\n\n`);
          }
        }
      });
      stream.on('end', () => {
        if (lastFinal) this.cache.set(cacheKey, lastFinal);
        res.end();
        void this.audit.append({
          userId: user.id,
          processCode,
          functionId: body.functionId ?? null,
          versionRef: body.versionRef ?? null,
          question: body.question,
          finalAnswer: lastFinal?.answer ?? '',
          chartSpec: lastFinal?.chart_spec ?? null,
          modelName: lastFinal?.model ?? null,
          modelDigest: null,
          latencyMs: Date.now() - started,
          toolCalls,
          generatedSql: lastFinal?.generated_sql ?? null,
          resultHash: lastFinal?.result_hash ?? null,
        });
      });
      stream.on('error', (err: Error) => {
        this.logger.error(`chat stream error: ${err.message}`);
        res.write(
          `data: ${JSON.stringify({ type: 'error', code: 'UPSTREAM', message: err.message })}\n\n`,
        );
        res.end();
      });
    } catch (err) {
      this.logger.error(`chat upstream failed: ${(err as Error).message}`);
      res.write(
        `data: ${JSON.stringify({
          type: 'error',
          code: 'UPSTREAM_UNAVAILABLE',
          message: (err as Error).message,
        })}\n\n`,
      );
      res.end();
    }
  }

  async chatHistory(processCode: string, user: SessionUser, functionId?: FunctionId) {
    await this.processAccess.findAccessibleProcessOrThrow(user, processCode, 'viewer');
    return this.audit.recent(processCode, functionId, 50);
  }

  /** Called by listeners on version.saved to evict cache for that scope. */
  evictCacheForScope(processCode: string, functionId?: FunctionId | null) {
    this.cache.evictMatching({ processCode, functionId: functionId ?? null });
  }
}
