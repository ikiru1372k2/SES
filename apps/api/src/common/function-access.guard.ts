import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { isFunctionId } from '@ses/domain';
import { FunctionsService } from '../functions.service';
import { PrismaService } from './prisma.service';
import { ProcessAccessService } from './process-access.service';

/**
 * Layered access check for every function-scoped route.
 *
 * Responsibilities (in order):
 *   1. Require an authenticated user (the global AuthGuard has already
 *      populated `request.user`; we re-check in case this guard is used
 *      on a route without AuthGuard).
 *   2. If the route has `:idOrCode` / `:processIdOrCode`, resolve it to a
 *      Process and assert the user is a member (or admin).
 *   3. If the route has `:functionId`, assert it's a valid registry id
 *      AND that `ProcessFunction.enabled` is true for this (process, function)
 *      pair. This blocks trying to reach a disabled or unknown function.
 *
 * Attach via `@UseGuards(AuthGuard, FunctionAccessGuard)` on the relevant
 * controllers. The guard is intentionally resilient — routes without the
 * scoped params simply skip those checks and return true.
 */
@Injectable()
export class FunctionAccessGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly processAccess: ProcessAccessService,
    private readonly functions: FunctionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user) {
      throw new ForbiddenException('Authentication required');
    }

    const params: Record<string, string | undefined> = request.params ?? {};
    const processParam = params.idOrCode ?? params.processIdOrCode ?? params.pid;
    if (processParam) {
      // Resolves + asserts membership. Throws 404 if not accessible.
      await this.processAccess.findAccessibleProcessOrThrow(user, processParam, 'viewer');
    }

    const fid = params.functionId ?? params.fid;
    if (fid) {
      if (!isFunctionId(fid)) {
        throw new NotFoundException(`Unknown function ${fid}`);
      }
      // Only enforce ProcessFunction.enabled when we also have a process scope.
      // If the route is function-only (no process), the registry check above
      // is sufficient.
      if (processParam) {
        const process = await this.prisma.process.findFirst({
          where: { OR: [{ id: processParam }, { displayCode: processParam }] },
          select: { id: true },
        });
        if (process) {
          const enabled = await this.functions.isEnabled(process.id, fid);
          if (!enabled) {
            throw new ForbiddenException(`Function ${fid} is not enabled for this process`);
          }
        }
      }
    }

    return true;
  }
}
