import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isFunctionId, type FunctionId } from '@ses/domain';
import { FunctionsService } from '../modules/functions/functions.service';
import {
  AccessScopeService,
  type ScopeAction,
  type ScopeContext,
  type ScopeKind,
} from './access-scope.service';
import { PrismaService } from './prisma.service';
import { ProcessAccessService } from './process-access.service';
import { REQUIRES_SCOPE_KEY, type RequiresScopeOptions } from './requires-scope.decorator';

function requestPathUrl(request: { path?: string; originalUrl?: string; url?: string }): string {
  const raw = request.originalUrl ?? request.url ?? request.path ?? '';
  return raw.split('?')[0] ?? '';
}

/**
 * Layered access check for process- and file-scoped routes.
 *
 * 1. Authenticated user (global AuthGuard).
 * 2. Routes under `/files/...` without `/processes/`: resolve `WorkbookFile`, require
 *    `ProcessMember`, require `ProcessFunction.enabled` for the file's `functionId`.
 * 3. Routes with a process id param (`:idOrCode` under `/processes/`, or `pid`, etc.):
 *    `findAccessibleProcessOrThrow` (membership + optional min permission via callers).
 * 4. If the route includes `:functionId` / `:fid`, require that function to be enabled
 *    for the process.
 * 5. After the above pass, consult `AccessScopeService` so that members with
 *    `ProcessMemberScopePermission` rows are confined to the scopes they were
 *    granted. Members without any scope rows behave exactly as before.
 */
@Injectable()
export class FunctionAccessGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly processAccess: ProcessAccessService,
    private readonly functions: FunctionsService,
    private readonly accessScope: AccessScopeService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user) {
      throw new ForbiddenException('Authentication required');
    }

    const params: Record<string, string | undefined> = request.params ?? {};
    const pathUrl = requestPathUrl(request);
    const isProcessScoped = pathUrl.includes('/processes/');
    const isBareFilesPath = pathUrl.includes('/files/') && !isProcessScoped;

    let processIdForFunctionCheck: string | undefined;
    let resolvedFileFunctionId: FunctionId | undefined;

    if (isBareFilesPath) {
      const fileKey = params.fileIdOrCode ?? params.idOrCode;
      if (fileKey) {
        const file = await this.prisma.workbookFile.findFirst({
          where: { OR: [{ id: fileKey }, { displayCode: fileKey }] },
          select: { processId: true, functionId: true },
        });
        if (!file) {
          throw new NotFoundException(`File ${fileKey} not found`);
        }
        await this.processAccess.assertCanAccessProcess(user, file.processId);
        const enabled = await this.functions.isEnabled(file.processId, file.functionId);
        if (!enabled) {
          throw new ForbiddenException(`Function ${file.functionId} is not enabled for this process`);
        }
        processIdForFunctionCheck = file.processId;
        if (isFunctionId(file.functionId)) {
          resolvedFileFunctionId = file.functionId;
        }
      }
    } else if (isProcessScoped) {
      const processParam = params.pid ?? params.processIdOrCode ?? params.idOrCode;
      if (processParam) {
        // F15: fail closed by HTTP method. Safe methods need only `viewer`;
        // any state-changing method requires at least `editor` at the guard.
        // Services may still demand more (e.g. `owner` for delete) — this
        // just stops the guard from waving every mutation through as viewer.
        const method = (request.method ?? 'GET').toUpperCase();
        const minPermission =
          method === 'GET' || method === 'HEAD' || method === 'OPTIONS' ? 'viewer' : 'editor';
        const process = await this.processAccess.findAccessibleProcessOrThrow(
          user,
          processParam,
          minPermission,
        );
        processIdForFunctionCheck = process.id;
      }
    }

    const fid = params.functionId ?? params.fid;
    if (fid) {
      if (!isFunctionId(fid)) {
        throw new NotFoundException(`Unknown function ${fid}`);
      }
      if (processIdForFunctionCheck) {
        const enabled = await this.functions.isEnabled(processIdForFunctionCheck, fid);
        if (!enabled) {
          throw new ForbiddenException(`Function ${fid} is not enabled for this process`);
        }
      }
    }

    if (processIdForFunctionCheck) {
      const ctx = this.deriveScopeContext({
        request,
        params,
        explicit: this.reflector.getAllAndOverride<RequiresScopeOptions | undefined>(
          REQUIRES_SCOPE_KEY,
          [context.getHandler(), context.getClass()],
        ),
        routeFunctionId: isFunctionId(fid ?? '') ? (fid as FunctionId) : resolvedFileFunctionId,
      });
      await this.accessScope.require(processIdForFunctionCheck, user, ctx);
    }

    return true;
  }

  private deriveScopeContext(args: {
    request: { method?: string };
    params: Record<string, string | undefined>;
    explicit: RequiresScopeOptions | undefined;
    routeFunctionId: FunctionId | undefined;
  }): ScopeContext {
    const method = (args.request.method ?? 'GET').toUpperCase();
    const defaultAction: ScopeAction = method === 'GET' || method === 'HEAD' ? 'view' : 'edit';

    if (args.explicit) {
      const kind: ScopeKind = args.explicit.kind;
      const action: ScopeAction = args.explicit.action ?? defaultAction;
      return kind === 'function'
        ? { kind, action, functionId: args.routeFunctionId }
        : { kind, action };
    }

    if (args.routeFunctionId) {
      return { kind: 'function', functionId: args.routeFunctionId, action: defaultAction };
    }
    return { kind: 'all-functions', action: defaultAction };
  }
}
