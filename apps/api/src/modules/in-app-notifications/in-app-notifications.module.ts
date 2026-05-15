import { Module } from '@nestjs/common';
        import { InAppNotificationsController } from './in-app-notifications.controller';
import { InAppNotificationsService } from './in-app-notifications.service';
        @Module({
  controllers: [InAppNotificationsController],
  providers: [InAppNotificationsService],
  exports: [InAppNotificationsService],
        })
        export class InAppNotificationsModule {}

