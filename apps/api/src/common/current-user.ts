import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { SessionUser } from '@ses/domain';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SessionUser => context.switchToHttp().getRequest().user,
);
