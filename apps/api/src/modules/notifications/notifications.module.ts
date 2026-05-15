import { Module } from '@nestjs/common';
        import { TrackingModule } from '../tracking/tracking.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
        @Module({
  imports: [TrackingModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
        })
        export class NotificationsModule {}

