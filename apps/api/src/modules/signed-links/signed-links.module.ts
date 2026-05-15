import { Module } from '@nestjs/common';
        import { SignedLinkController } from './signed-link.controller';
import { PublicResponseController } from './public-response.controller';
import { SignedLinkTokenService } from './signed-link-token.service';
import { SignedLinkService } from './signed-link.service';
import { PublicResponseService } from './public-response.service';
        @Module({
  controllers: [SignedLinkController, PublicResponseController],
  providers: [SignedLinkTokenService, SignedLinkService, PublicResponseService],
        })
        export class SignedLinksModule {}

