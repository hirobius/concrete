# Contributing

## Setup

You need Node 24 and pnpm.

```bash
pnpm install
pnpm dev
```

The site runs at http://localhost:5180. Checkout needs keys in `.env.local`.
See [docs/sale-flow.md](docs/sale-flow.md).

## Check

Run this before each push:

```bash
pnpm check
```

It runs the typecheck, the tests and the docs check (`scripts/check-repo-docs.mjs`).
Before a launch, also run `pnpm check:launch`.

## Branch and pull request

1. Branch from `main`.
2. Keep the pull request small. One pull request is one change.
3. Write commit subjects as `type: what changed`, in plain English, 72 characters or less.
   Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`.
4. Fill in the pull request template. Add screenshots for a visual change.

## Issues

File bugs and tasks in this repository's GitHub Issues. Use the templates.
Report a security problem in private. See [SECURITY.md](SECURITY.md).
