import { Module } from '@nestjs/common';
        import { EscalationsModule } from '../escalations/escalations.module';
import { ProcessesController } from './processes.controller';
import { ProcessActivityController } from './process-activity.controller';
import { ProcessesService } from './processes.service';
        @Module({
  imports: [EscalationsModule],
  controllers: [ProcessesController, ProcessActivityController],
  providers: [ProcessesService],
        })
        export class ProcessesModule {}

