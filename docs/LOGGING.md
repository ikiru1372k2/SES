# Logging Conventions

## Backend (`apps/api`)

### Use `Logger` from `@nestjs/common`, never `console.*`

```ts
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class MyService {
  private readonly logger = new Logger(MyService.name);

  doSomething() {
    this.logger.log('process created', { processId });   // INFO
    this.logger.warn('quota nearly full', { usage });    // WARN
    this.logger.error('payment failed', stack);          // ERROR
  }
}
```

Using NestJS Logger gives you:
- Consistent `[ServiceName] message` prefix
- ISO-8601 timestamps
- Log-level filtering via `app.useLogger()`

### When to use each level

| Level | When |
|-------|------|
| `log` (INFO) | Normal lifecycle events — process created, audit started, user logged in |
| `warn` | Expected degraded states — fallback used, retry about to happen, quota high |
| `error` | Unexpected failures where a human may need to act — DB down, external API unreachable |
| `debug` | High-frequency diagnostic data; disabled in production by default |
| `verbose` | Low-level wire trace; only for local deep-dive debugging |

**Rule of thumb:** If you are about to `throw`, you usually do NOT also log — the global exception filter will log the error with full context. Only log when you are swallowing the error and continuing.

### When to throw vs. log

| Situation | Action |
|-----------|--------|
| Caller error (bad input, auth failure) | `throw` an HTTP exception; do not log |
| Unrecoverable server error | `throw`; global filter logs with request ID |
| Recoverable degraded path | `logger.warn` above the fallback code |
| Context you want in the trace | `logger.log` or `logger.debug` |

### Request tracing

Every request gets an `x-request-id` header injected by the middleware in `main.ts`. The value is echoed back in the `X-Request-ID` response header.

To trace all log lines for a single request:

```bash
# Docker / stdout logs
docker compose logs api | grep "REQ-2026-xxx"

# Or when running locally with a terminal
npm run start:dev --workspace @ses/api 2>&1 | grep "REQ-2026-xxx"
```

The request ID is also stored in `requestContext` (AsyncLocalStorage) and can be accessed in any service via `requestContext.get().requestId`.

---

## Frontend (`apps/web`)

### Rules

1. **No `console.log`** — remove before committing.
2. **`console.warn` and `console.error` are allowed only where there is a documented recovery path** — a one-line comment immediately above the call must explain what the app does instead (e.g., "Recovery: falls back to local engine").
3. **`console.info` / `console.debug`** — not allowed in committed code.

### Structured debug events

For error boundaries and significant client-side failures, write to the structured debug log instead of (or in addition to) the console:

```ts
import { recordDebugEvent } from '../lib/debugLog';

recordDebugEvent({ message: 'Something went wrong', stack: error.stack });
```

The debug log is capped at 20 events, persisted in `localStorage` under `ses-debug-events`, and readable at `/debug` in dev mode. This lets support engineers ask users to copy-paste their debug log without opening devtools.
