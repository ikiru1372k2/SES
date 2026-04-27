import { Module } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { ProcessAccessService } from '../../common/process-access.service';
import { IdentifierService } from '../../common/identifier.service';
import { ActivityLogService } from '../../common/activity-log.service';
import { AuthService } from '../../auth.service';
import { EscalationsService } from '../../escalations.service';
import { PresenceRegistry } from '../../realtime/presence.registry';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { ComposeRenderService } from './compose-render.service';
import { ComposeDraftService } from './compose-draft.service';
import { ComposeSendService } from './compose-send.service';

@Module({
  providers: [
    PrismaService,
    ProcessAccessService,
    IdentifierService,
    ActivityLogService,
    AuthService,
    EscalationsService,
    PresenceRegistry,
    RealtimeGateway,
    ComposeRenderService,
    ComposeDraftService,
    ComposeSendService,
  ],
  exports: [ComposeDraftService, ComposeSendService],
})
export class ComposeModule {}
