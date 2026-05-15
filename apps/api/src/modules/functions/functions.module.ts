import { Module } from '@nestjs/common';
      import { FunctionsController } from './functions.controller';
      @Module({
controllers: [FunctionsController],
      })
      export class FunctionsModule {}

