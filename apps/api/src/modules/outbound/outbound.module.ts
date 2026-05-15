import { Module } from '@nestjs/common';
      import { OutboundDeliveryService } from './outbound-delivery.service';
      @Module({
providers: [OutboundDeliveryService],
exports: [OutboundDeliveryService],
      })
      export class OutboundModule {}

