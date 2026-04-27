import { Module } from '@nestjs/common';
import { ProcessCrudService } from './process-crud.service';
import { ProcessPolicyService } from './process-policy.service';
import { ProcessMemberService } from './process-member.service';
import { ProcessTilesService } from './process-tiles.service';

@Module({
  providers: [
    ProcessCrudService,
    ProcessPolicyService,
    ProcessMemberService,
    ProcessTilesService,
  ],
  exports: [
    ProcessCrudService,
    ProcessPolicyService,
    ProcessMemberService,
    ProcessTilesService,
  ],
})
export class ProcessModule {}
