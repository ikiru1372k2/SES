# Contributing

## Local Setup

```powershell
npm install
npm run dev
```

Open `http://localhost:3210/`.

## Verification

Run these before pushing:

```powershell
npm run lint
npm run typecheck
npm test
npm run test:components
npm audit --audit-level=high
npm run build
```

## Dependency Changes

When `package.json` changes, regenerate and commit `package-lock.json`:

```powershell
npm install
npm ci --dry-run
```

CI also checks lockfile drift with `npm install --package-lock-only --ignore-scripts`.

## Branching

Use focused commits:

- `feat:` for product behavior
- `fix:` for bugs
- `chore:` for tooling, dependencies, and CI
- `docs:` for documentation
