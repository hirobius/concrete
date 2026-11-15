# Hirobius Studio

A storefront for concrete figurines: Vite, React Router, Tailwind, Stripe Checkout, Vercel.

## Commands

- `pnpm dev` - run the site at http://localhost:5180.
- `pnpm check` - typecheck, tests and the docs check. Run it before each push.
- `pnpm check:launch` - the launch gate: token overlay and catalog placeholders.
- `pnpm catalog:add` - add or edit a product. Do not edit `data/products.json` by hand.
- `pnpm tokens:overlay` - write `src/styles/tenant-overlay.generated.css` from `tenant/tokens.json`.

## Rules

- Keep README.md, CONTRIBUTING.md and this file inside the caps in `scripts/check-repo-docs.mjs`.
- Put detail in `docs/`, one subject per file.
- Never commit keys. `.env.local` holds the values. `docs/sale-flow.md` lists the names.
- Do not edit the generated overlay CSS. Change `tenant/tokens.json` and run the tool.
- `scripts/lib/product-schema.mjs` and the `Product` type in `src/lib/products.ts` must agree.
- Product photos go through `pnpm photos`. See `docs/PRODUCT-IMAGES.md`.
- Commit subjects are `type: what changed`.

## Fleet hub
This repo is part of the Hirobius fleet. The operations hub is the
hirobius/ops repo: fleet state at /api/projects, consolidated tasks at
/ops/tasks (this repo's GitHub Issues sync there), current cross-project
state in docs/ai/HANDOFF.md (in ops). Conventions for every session here:
(a) track new work as GitHub Issues in THIS repo — never a local TODO
file; (b) before ending any session that changed project state, update
root status.json (updatedAt, phase, headline, next, blocked) — the ops
dashboard renders it; (c) read the ops HANDOFF before cross-project
decisions.
