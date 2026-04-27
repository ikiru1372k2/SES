import { IsString } from 'class-validator';

export class PickSheetDto {
  @IsString()
  sheetName!: string;
}
