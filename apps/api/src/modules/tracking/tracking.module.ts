import { Module } from '@nestjs/common';
        import { EscalationsModule } from '../escalations/escalations.module';
import { OutboundModule } from '../outbound/outbound.module';
import { TrackingController } from './tracking.controller';
import { TrackingService } from './tracking.service';
import { StatusReconcilerService } from './status-reconciler.service';
import { TrackingBulkController } from './bulk/tracking-bulk.controller';
import { TrackingBulkService } from './bulk/tracking-bulk.service';
import { TrackingComposeController } from './compose/tracking-compose.controller';
import { TrackingComposeService } from './compose/tracking-compose.service';
import { TrackingStageController } from './stage/tracking-stage.controller';
import { TrackingStageService } from './stage/tracking-stage.service';
import { TrackingAttachmentsController } from './attachments/tracking-attachments.controller';
import { TrackingAttachmentsService } from './attachments/tracking-attachments.service';
        @Module({
  imports: [EscalationsModule, OutboundModule],
  controllers: [TrackingController, TrackingBulkController, TrackingComposeController, TrackingStageController, TrackingAttachmentsController],
  providers: [TrackingService, StatusReconcilerService, TrackingBulkService, TrackingComposeService, TrackingStageService, TrackingAttachmentsService],
  exports: [TrackingService, StatusReconcilerService],
        })
        export class TrackingModule {}

