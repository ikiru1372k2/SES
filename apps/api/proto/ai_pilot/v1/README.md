# `ses.ai_pilot.v1`

Wire contract between `@ses/api` (Nest, gRPC client) and the FastAPI AI
sidecar (gRPC server, owned by a different repository). The frontend
never sees this — it talks HTTP to the Nest controller.

## Generating TypeScript

```bash
npm run proto:gen --workspace @ses/api
```

Outputs to `apps/api/src/proto-gen/ai_pilot/v1/`. Files are committed to
the repo (no codegen at runtime). CI runs the script and checks for a
clean `git diff` to catch out-of-date stubs.

## Versioning

The package is `ses.ai_pilot.v1`. Breaking changes (renamed fields,
removed RPCs, changed semantics) require a new `v2` package — never
modify `v1` in a wire-incompatible way.
