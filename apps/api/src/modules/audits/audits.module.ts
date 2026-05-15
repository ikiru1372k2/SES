import { Module } from '@nestjs/common';
        import { TrackingModule } from '../tracking/tracking.module';
import { AiPilotModule } from '../ai-pilot/ai-pilot.module';
import { AuditsController } from './audits.controller';
import { AuditsService } from './audits.service';
        @Module({
  imports: [TrackingModule, AiPilotModule],
  controllers: [AuditsController],
  providers: [AuditsService],
        })
        export class AuditsModule {}

