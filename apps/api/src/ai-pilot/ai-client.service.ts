import { HttpService } from '@nestjs/axios';
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { validateSpec } from '@ses/domain';
import type { AiRuleSpec } from '@ses/domain';

export type GenerateResult =
  | { success: true; spec: AiRuleSpec; raw: unknown }
  | { success: false; raw: unknown; error: string };

export interface FastApiUploadResult {
  session_id: string;
  file_name: string;
  size_mb: number;
  columns: string[];
  preview_markdown?: string;
}

@Injectable()
export class AiClientService {
  private readonly logger = new Logger(AiClientService.name);

  constructor(private readonly http: HttpService) {}

  async health(): Promise<{ ok: boolean; raw?: unknown; error?: string }> {
    try {
      const r = await firstValueFrom(this.http.get('/health'));
      return { ok: true, raw: r.data };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Uploads a buffer to FastAPI for Docling parsing. Best-effort — failure
   * does not block the sandbox flow (we already have parseWorkbookBuffer
   * locally for sheet/column metadata).
   */
  async uploadForParse(
    buffer: Buffer,
    fileName: string,
  ): Promise<{ ok: true; data: FastApiUploadResult } | { ok: false; error: string }> {
    try {
      const FormData = (await import('form-data')).default;
      const form = new FormData();
      form.append('file', buffer, { filename: fileName });
      const r = await firstValueFrom(
        this.http.post<FastApiUploadResult>('/pilot/upload', form, {
          headers: form.getHeaders(),
        }),
      );
      return { ok: true, data: r.data };
    } catch (err) {
      this.logger.warn(
        `FastAPI /pilot/upload failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async generate(payload: {
    prompt: string;
    columns: string[];
    functionId: string;
    sessionId: string;
  }): Promise<GenerateResult> {
    let raw: unknown;
    try {
      const r = await firstValueFrom(
        this.http.post('/pilot/generate', {
          session_id: payload.sessionId,
          engine: payload.functionId,
          description: payload.prompt,
          columns: payload.columns,
        }),
      );
      raw = r.data;
    } catch (err) {
      this.logger.error(
        `FastAPI /pilot/generate unreachable: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new ServiceUnavailableException('AI service unavailable');
    }

    // FastAPI may shape its response as { success, rule, error } or { spec, raw }.
    // Normalize both forms.
    const candidate =
      (raw as { spec?: unknown }).spec ??
      (raw as { rule?: unknown }).rule ??
      raw;
    const validation = validateSpec(candidate);
    if (!validation.ok) {
      return { success: false, raw, error: validation.error };
    }
    return { success: true, spec: validation.spec, raw };
  }

  async enhance(payload: {
    prompt: string;
    columns: string[];
    engine: string;
    sessionId: string;
  }): Promise<{ enhancedPrompt: string; raw: unknown }> {
    try {
      const r = await firstValueFrom(
        this.http.post<{ enhanced_prompt: string }>('/pilot/enhance', {
          session_id: payload.sessionId,
          engine: payload.engine,
          prompt: payload.prompt,
          columns: payload.columns,
        }),
      );
      const enhanced = r.data?.enhanced_prompt;
      if (typeof enhanced !== 'string' || !enhanced.trim()) {
        throw new Error('AI enhancer returned empty response');
      }
      return { enhancedPrompt: enhanced.trim(), raw: r.data };
    } catch (err) {
      this.logger.error(
        `FastAPI /pilot/enhance unreachable: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new ServiceUnavailableException('AI service unavailable');
    }
  }
}
