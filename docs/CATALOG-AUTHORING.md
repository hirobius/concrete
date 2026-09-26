# Catalog authoring

How a product gets into `data/products.json` without hand-editing JSON, and
what keeps a malformed one out.

## The pieces

| Piece | File | Job |
|---|---|---|
| Data model | `src/lib/products.ts` (`Product` type) | The shape the app renders. |
| Schema/validator | `scripts/lib/product-schema.mjs` | The rules (see below). No dependency — plain JS, hand-kept in sync with the type. |
| Tests | `scripts/lib/product-schema.test.mjs` | `pnpm test` — Node's built-in test runner, no new dependency. |
| Guided authoring | `scripts/add-product.mjs` | `pnpm catalog:add` — prompts for each field, validates, writes. Refuses to write an invalid entry. |
| Launch gate | `scripts/check-launch-ready.mjs` (`product-schema` check) | `pnpm check:launch` — fails the pre-launch check if `data/products.json` has a malformed entry, however it got there. |

## Add a product

```bash
pnpm catalog:add
```

Answer the prompts (title, subtitle, story, dimensions, materials, price,
edition counts, at least one image). The tool validates before writing —
if anything fails, nothing is written and it tells you which field(s) to fix.

Then, same as before:

1. Drop photos in `public/products/<slug>/` and point `images[].src` at them
   (the tool lets you enter these interactively).
2. Create the Stripe product + price in the Dashboard (SETUP.md §3), paste
   the `price_…` id in when prompted, or `pnpm catalog:add -- --edit <slug>`
   afterward to fill it in.
3. Run `pnpm check:launch` — it will flag a placeholder `price_TODO_…` or
   `price_sample_…` id, a placeholder image, or a schema violation.
4. Commit.

## Edit an existing product

```bash
pnpm catalog:add -- --edit <slug>
```

Same prompts, pre-filled with the current values; Enter keeps the current
value for a field.

## Validate without the interactive flow

```bash
pnpm catalog:validate
```

Runs the same schema against `data/products.json` and prints every error
(or confirms the catalog is clean). This is what CI/`check:launch` runs
under the hood (`product-schema` check) — use it to check a hand-edit before
committing.

## The rules (`scripts/lib/product-schema.mjs`)

- `slug` — required, kebab-case, unique across the catalog.
- `title`, `subtitle`, `story`, `dimensions` — required non-empty strings.
- `materials` — non-empty array of non-empty strings.
- `priceUsd` — number, `> 0`.
- `stripePriceId` — non-empty string starting with `price_`.
- `edition.total`, `edition.remaining` — non-negative integers; `remaining <= total`.
- `status` — one of `available`, `sold-out`, `archived`.
- `images` — non-empty array; each entry needs a non-empty `src` **and** a
  non-empty `alt` (per-image — describe that frame, not just the product name).
- `artist` (optional) — if present, `slug`/`name` required, `splitPercent` a
  number `0`–`100`.

This is schema/structure validation only. It does **not** check whether a
`stripePriceId` is a live Stripe price, or whether an image file actually
exists on disk at that path — `check-launch-ready.mjs`'s other checks
(`stripe-price-ids`, `real-photography`) cover those, and a live test order
is the only real proof Stripe is wired (see `docs/GO-LIVE-RUNBOOK.md`).
