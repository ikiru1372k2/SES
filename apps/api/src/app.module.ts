import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { DatabaseModule } from './db/database.module';
import { CoreModule } from './common/core.module';
import { ObjectStorageModule } from './modules/object-storage';
import { AiPilotModule } from './modules/ai-pilot/ai-pilot.module';
import { PdfProcessingModule } from './modules/pdf-processing/pdf-processing.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { RulesModule } from './modules/rules/rules.module';
import { FunctionsModule } from './modules/functions/functions.module';
import { ProcessesModule } from './modules/processes/processes.module';
import { FilesModule } from './modules/files/files.module';
import { AuditsModule } from './modules/audits/audits.module';
import { VersionsModule } from './modules/versions/versions.module';
import { IssuesModule } from './modules/issues/issues.module';
import { TrackingModule } from './modules/tracking/tracking.module';
import { TemplatesModule } from './modules/templates/templates.module';
import { ActivityModule } from './modules/activity/activity.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { ExportsModule } from './modules/exports/exports.module';
import { SignedLinksModule } from './modules/signed-links/signed-links.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { DirectoryModule } from './modules/directory/directory.module';
import { EscalationsModule } from './modules/escalations/escalations.module';
import { EscalationTemplatesModule } from './modules/escalation-templates/escalation-templates.module';
import { OutboundModule } from './modules/outbound/outbound.module';
import { InAppNotificationsModule } from './modules/in-app-notifications/in-app-notifications.module';
import { SavedViewsModule } from './modules/saved-views/saved-views.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';

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
    DatabaseModule,
    CoreModule,
    ObjectStorageModule,
    AiPilotModule,
    PdfProcessingModule,
    HealthModule,
    AuthModule,
    RulesModule,
    FunctionsModule,
    ProcessesModule,
    FilesModule,
    AuditsModule,
    VersionsModule,
    IssuesModule,
    TrackingModule,
    TemplatesModule,
    ActivityModule,
    JobsModule,
    ExportsModule,
    SignedLinksModule,
    NotificationsModule,
    DirectoryModule,
    EscalationsModule,
    EscalationTemplatesModule,
    OutboundModule,
    InAppNotificationsModule,
    SavedViewsModule,
    AnalyticsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
