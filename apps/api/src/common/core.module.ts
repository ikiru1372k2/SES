import { Global, Module } from '@nestjs/common';
import { AccessScopeService } from './access-scope.service';
import { ActivityLogService } from './activity-log.service';
import { FunctionAccessGuard } from './function-access.guard';
import { IdentifierService } from './identifier.service';
import { ProcessAccessService } from './process-access.service';
import { UploadValidationPipe } from './pipes/upload-validation.pipe';
import { AuthService } from '../modules/auth/auth.service';
import { AuthGuard } from '../modules/auth/auth.guard';
import { FunctionsService } from '../modules/functions/functions.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { PresenceRegistry } from '../realtime/presence.registry';

/**
 * Cross-cutting singletons used by many feature modules. @Global so
 * features need not re-import it. DatabaseModule is separately @Global,
 * so PrismaService/PgService are already injectable here.
 */
@Global()
@Module({
  providers: [
    ProcessAccessService, AccessScopeService, IdentifierService,
    ActivityLogService, AuthService, AuthGuard, FunctionsService,
    FunctionAccessGuard, RealtimeGateway, PresenceRegistry,
    UploadValidationPipe,
  ],
  exports: [
    ProcessAccessService, AccessScopeService, IdentifierService,
    ActivityLogService, AuthService, AuthGuard, FunctionsService,
    FunctionAccessGuard, RealtimeGateway, PresenceRegistry,
    UploadValidationPipe,
  ],
})
export class CoreModule {}

