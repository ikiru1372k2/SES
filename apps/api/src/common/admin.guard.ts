import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{ user?: { role?: string } }>();
    if (req.user?.role !== 'admin') {
      throw new ForbiddenException('Admin role required');
    }
    return true;
  }
}
