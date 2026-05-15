import { Module } from '@nestjs/common';
        import { EscalationTemplatesController } from './escalation-templates.controller';
import { EscalationTemplatesService } from './escalation-templates.service';
        @Module({
  controllers: [EscalationTemplatesController],
  providers: [EscalationTemplatesService],
        })
        export class EscalationTemplatesModule {}

