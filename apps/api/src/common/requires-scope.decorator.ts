import { SetMetadata } from '@nestjs/common';
import type { ScopeAction, ScopeKind } from './access-scope.service';

export const REQUIRES_SCOPE_KEY = 'requiresScope';

export interface RequiresScopeOptions {
  kind: ScopeKind;
  /** Overrides the HTTP-method default (GET/HEAD => 'view', else 'edit'). */
  action?: ScopeAction;
}

export const RequiresScope = (opts: RequiresScopeOptions) =>
  SetMetadata(REQUIRES_SCOPE_KEY, opts);
