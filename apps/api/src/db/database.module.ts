import { Global, Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { PgService } from './pg.service';

@Global()
@Module({
  providers: [PrismaService, PgService],
  exports: [PrismaService, PgService],
})
export class DatabaseModule {}
