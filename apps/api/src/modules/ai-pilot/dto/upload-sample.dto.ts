import { IsIn } from 'class-validator';
import { FUNCTION_IDS, type FunctionId } from '@ses/domain';

export class UploadSampleDto {
  @IsIn([...FUNCTION_IDS])
  functionId!: FunctionId;
}
