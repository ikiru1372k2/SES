import { Module } from '@nestjs/common';
        import { InAppNotificationsModule } from '../in-app-notifications/in-app-notifications.module';
import { EscalationsService } from './escalations.service';
import { EscalationLevelService } from './escalation-level.service';
import { SlaEngineService } from './sla-engine.service';
        @Module({
  imports: [InAppNotificationsModule],
  providers: [EscalationsService, EscalationLevelService, SlaEngineService],
  exports: [EscalationsService, EscalationLevelService],
        })
        export class EscalationsModule {}
