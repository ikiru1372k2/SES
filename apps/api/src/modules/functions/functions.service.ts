import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { FUNCTION_REGISTRY, type FunctionId } from '@ses/domain';
import { PrismaService } from '../../common/prisma.service';

/**
 * System-function registry bridge.
 *
 * Responsibilities:
 *   - On boot: upsert every entry from `FUNCTION_REGISTRY` into `SystemFunction`
 *     so DB and domain registry stay in lockstep across deploys.
 *   - Read-only access: `list()` returns the registry for the `GET /functions`
 *     endpoint (used by admin screens + client verification).
 *   - `ensureProcessFunctions()`: seed `ProcessFunction` rows for a given
 *     process so every tile is enabled by default.
 *
 * Mutation is not supported — functions are system-defined. Any future need
 * to toggle a per-process function goes through `ProcessFunction.enabled`.
 */
@Injectable()
export class FunctionsService implements OnModuleInit {
  private readonly logger = new Logger(FunctionsService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.seed();
  }

  /** Idempotent upsert of the registry. Safe to call on every boot. */
  async seed(): Promise<void> {
    for (const fn of FUNCTION_REGISTRY) {
      await this.prisma.systemFunction.upsert({
        where: { id: fn.id },
        create: { id: fn.id, label: fn.label, displayOrder: fn.displayOrder, isSystem: true },
        update: { label: fn.label, displayOrder: fn.displayOrder, isSystem: true },
      });
    }
    this.logger.log(`Seeded ${FUNCTION_REGISTRY.length} system functions`);
  }

  list() {
    return FUNCTION_REGISTRY.map((fn) => ({ ...fn }));
  }

  async ensureProcessFunctions(processId: string): Promise<void> {
    for (const fn of FUNCTION_REGISTRY) {
      await this.prisma.processFunction.upsert({
        where: { processId_functionId: { processId, functionId: fn.id } },
        create: { processId, functionId: fn.id, enabled: true },
        update: {},
      });
    }
  }

  async isEnabled(processId: string, functionId: FunctionId | string): Promise<boolean> {
    const row = await this.prisma.processFunction.findUnique({
      where: { processId_functionId: { processId, functionId } },
    });
    return Boolean(row?.enabled);
  }
}
