import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isFunctionId } from '@ses/domain';
import { FunctionsService } from '../functions.service';
import { PrismaService } from './prisma.service';
import { ProcessAccessService } from './process-access.service';

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
    const pathUrl = requestPathUrl(request);
    const isProcessScoped = pathUrl.includes('/processes/');
    const isBareFilesPath = pathUrl.includes('/files/') && !isProcessScoped;

    let processIdForFunctionCheck: string | undefined;

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
      }
    } else if (isProcessScoped) {
      const processParam = params.pid ?? params.processIdOrCode ?? params.idOrCode;
      if (processParam) {
        const process = await this.processAccess.findAccessibleProcessOrThrow(user, processParam, 'viewer');
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

    return true;
  }
}
