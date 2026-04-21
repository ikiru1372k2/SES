import { Injectable, PipeTransform } from '@nestjs/common';
import { validateWorkbookMultipartAsync } from '../security/workbook-upload';

@Injectable()
export class UploadValidationPipe implements PipeTransform<Express.Multer.File | undefined, Promise<Express.Multer.File>> {
  async transform(value: Express.Multer.File | undefined): Promise<Express.Multer.File> {
    await validateWorkbookMultipartAsync(value);
    return value!;
  }
}
