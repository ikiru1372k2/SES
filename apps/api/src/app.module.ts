import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ActivityLogService } from './common/activity-log.service';
import { IdentifierService } from './common/identifier.service';
import { ProcessAccessService } from './common/process-access.service';
import { PrismaService } from './common/prisma.service';
import { ActivityController } from './activity.controller';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { AuditsController } from './audits.controller';
import { AuditsService } from './audits.service';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { IssuesController } from './issues.controller';
import { IssuesService } from './issues.service';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
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
import { PublicResponseService } from './signed-links/public-response.service';
import { PublicResponseController } from './signed-links/public-response.controller';
import { NotificationsController } from './notifications/notifications.controller';
import { NotificationsService } from './notifications/notifications.service';

@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000,
        limit: 400,
      },
    ]),
  ],
  controllers: [
    AuthController,
    RulesController,
    ProcessesController,
    ProcessActivityController,
    FilesController,
    AuditsController,
    VersionsController,
    IssuesController,
    TrackingController,
    TemplatesController,
    ActivityController,
    JobsController,
    ExportsController,
    PublicResponseController,
    NotificationsController,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    PrismaService,
    ProcessAccessService,
    IdentifierService,
    ActivityLogService,
    AuthService,
    AuthGuard,
    RulesService,
    ProcessesService,
    FilesService,
    AuditsService,
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
  ],
  exports: [
    PrismaService,
    ProcessAccessService,
    IdentifierService,
    ActivityLogService,
    AuthService,
    AuthGuard,
    RealtimeGateway,
    PresenceRegistry,
  ],
})
export class AppModule {}
