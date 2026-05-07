import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AccessScopeService } from './common/access-scope.service';
import { ActivityLogService } from './common/activity-log.service';
import { FunctionAccessGuard } from './common/function-access.guard';
import { IdentifierService } from './common/identifier.service';
import { ProcessAccessService } from './common/process-access.service';
import { PrismaService } from './common/prisma.service';
import { PgService } from './db/pg.service';
import { ActivityController } from './activity.controller';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { AuditsController } from './audits.controller';
import { AuditsService } from './audits.service';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';
import { FileDraftsController } from './file-drafts.controller';
import { FileDraftsService } from './file-drafts.service';
import { FileVersionsController } from './file-versions.controller';
import { FileVersionsService } from './file-versions.service';
import { FilesController } from './files.controller';
import { FilesRepository } from './files.repository';
import { FilesService } from './files.service';
import { FunctionsController } from './functions.controller';
import { FunctionsService } from './functions.service';
import { IssuesController } from './issues.controller';
import { IssuesService } from './issues.service';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { HealthController } from './health.controller';
import { EscalationsService } from './escalations.service';
import { ProcessesController } from './processes.controller';
import { ProcessActivityController } from './process-activity.controller';
import { ProcessesService } from './processes.service';
import { RulesController } from './rules.controller';
import { RulesService } from './rules.service';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';
import { TrackingController } from './tracking.controller';
import { TrackingService } from './tracking.service';
import { VersionsController } from './versions.controller';
import { VersionsService } from './versions.service';
import { PresenceRegistry } from './realtime/presence.registry';
import { RealtimeGateway } from './realtime/realtime.gateway';
import { SignedLinkTokenService } from './signed-links/signed-link-token.service';
import { SignedLinkService } from './signed-links/signed-link.service';
import { SignedLinkController } from './signed-links/signed-link.controller';
import { PublicResponseService } from './signed-links/public-response.service';
import { PublicResponseController } from './signed-links/public-response.controller';
import { NotificationsController } from './notifications/notifications.controller';
import { NotificationsService } from './notifications/notifications.service';
import { UploadValidationPipe } from './common/pipes/upload-validation.pipe';
import { DirectoryController } from './directory/directory.controller';
import { DirectoryService } from './directory/directory.service';
import { StatusReconcilerService } from './status-reconciler.service';
import { EscalationTemplatesController } from './escalation-templates/escalation-templates.controller';
import { EscalationTemplatesService } from './escalation-templates/escalation-templates.service';
import { TrackingComposeController } from './tracking-compose/tracking-compose.controller';
import { TrackingComposeService } from './tracking-compose/tracking-compose.service';
import { TrackingStageController } from './tracking-stage/tracking-stage.controller';
import { TrackingStageService } from './tracking-stage/tracking-stage.service';
import { TrackingAttachmentsController } from './tracking-attachments/tracking-attachments.controller';
import { TrackingAttachmentsService } from './tracking-attachments/tracking-attachments.service';
import { OutboundDeliveryService } from './outbound/outbound-delivery.service';
import { TrackingBulkController } from './tracking-bulk.controller';
import { TrackingBulkService } from './tracking-bulk.service';
import { InAppNotificationsController } from './in-app-notifications.controller';
import { InAppNotificationsService } from './in-app-notifications.service';
import { SavedViewsController } from './saved-views.controller';
import { SavedViewsService } from './saved-views.service';
import { SlaEngineService } from './sla-engine.service';
import { AiPilotModule } from './ai-pilot/ai-pilot.module';
import { ObjectStorageModule } from './object-storage';
import { PdfProcessingModule } from './pdf-processing/pdf-processing.module';

@Module({
  imports: [
    // `limit` is a Resolvable function so NODE_ENV is read per-request
    // instead of being captured at module init. Earlier fixes that read
    // it once (forRoot at decoration time, then forRootAsync at module
    // init) were still racing the e2e harness's NODE_ENV=test assignment
    // in createApp() under `node --test`, so the last RBAC tests kept
    // flaking on 429s. A per-request resolver removes the timing window.
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000,
        limit: () => (process.env.NODE_ENV === 'test' ? 10_000 : 400),
      },
    ]),
    AiPilotModule,
    ObjectStorageModule,
    PdfProcessingModule,
  ],
  controllers: [
    HealthController,
    AuthController,
    RulesController,
    FunctionsController,
    ProcessesController,
    ProcessActivityController,
    FilesController,
    FileVersionsController,
    FileDraftsController,
    AuditsController,
    VersionsController,
    IssuesController,
    TrackingController,
    TemplatesController,
    ActivityController,
    JobsController,
    ExportsController,
    PublicResponseController,
    SignedLinkController,
    NotificationsController,
    DirectoryController,
    EscalationTemplatesController,
    // Register bulk controller before the per-entry compose controller so
    // that POST /tracking/bulk/compose matches the literal `bulk` segment
    // instead of being captured by `:idOrCode` on the compose controller.
    TrackingBulkController,
    TrackingComposeController,
    TrackingStageController,
    TrackingAttachmentsController,
    InAppNotificationsController,
    SavedViewsController,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    PrismaService,
    PgService,
    ProcessAccessService,
    AccessScopeService,
    IdentifierService,
    ActivityLogService,
    AuthService,
    AuthGuard,
    FunctionsService,
    FunctionAccessGuard,
    RulesService,
    ProcessesService,
    EscalationsService,
    FilesRepository,
    FilesService,
    FileVersionsService,
    FileDraftsService,
    AuditsService,
    StatusReconcilerService,
    VersionsService,
    IssuesService,
    TrackingService,
    TemplatesService,
    ExportsService,
    JobsService,
    PresenceRegistry,
    RealtimeGateway,
    SignedLinkTokenService,
    SignedLinkService,
    PublicResponseService,
    NotificationsService,
    UploadValidationPipe,
    DirectoryService,
    OutboundDeliveryService,
    EscalationTemplatesService,
    TrackingComposeService,
    TrackingStageService,
    TrackingAttachmentsService,
    TrackingBulkService,
    InAppNotificationsService,
    SavedViewsService,
    SlaEngineService,
  ],
  exports: [
    PrismaService,
    ProcessAccessService,
    AccessScopeService,
    IdentifierService,
    ActivityLogService,
    AuthService,
    AuthGuard,
    FunctionsService,
    FunctionAccessGuard,
    RealtimeGateway,
    PresenceRegistry,
  ],
})
export class AppModule {}
