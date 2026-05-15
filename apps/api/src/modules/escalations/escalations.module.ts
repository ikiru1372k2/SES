import { Module } from '@nestjs/common';
        import { InAppNotificationsModule } from '../in-app-notifications/in-app-notifications.module';
import { EscalationsService } from './escalations.service';
import { SlaEngineService } from './sla-engine.service';
        @Module({
  imports: [InAppNotificationsModule],
  providers: [EscalationsService, SlaEngineService],
  exports: [EscalationsService],
        })
        export class EscalationsModule {}

