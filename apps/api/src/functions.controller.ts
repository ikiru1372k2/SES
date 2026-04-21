import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { FunctionsService } from './functions.service';

@Controller('functions')
@UseGuards(AuthGuard)
export class FunctionsController {
  constructor(private readonly functions: FunctionsService) {}

  @Get()
  list() {
    return this.functions.list();
  }
}
