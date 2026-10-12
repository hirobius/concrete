# Hirobius Studio

Storefront for Hirobius LLC's concrete figurine product line. Handmade,
cast in small editions, made in Spokane, Washington.

- **Domain (planned):** `hirobius.studio`
- **Stack:** Vite + React Router + Tailwind + Stripe Checkout
- **Hosting:** Vercel (static + serverless functions)
- **Catalog:** `data/products.json` (content) + Stripe Products (price + payment)

## Local dev

```bash
pnpm install
cp .env.example .env.local
# fill in STRIPE_*, DISCORD_SALES_WEBHOOK_URL
pnpm dev
```

For Stripe webhook testing locally:

```bash
stripe listen --forward-to localhost:5180/api/stripe-webhook
# copy the signing secret it prints into STRIPE_WEBHOOK_SECRET
```

## Adding a Form

```bash
pnpm catalog:add
```

Guided flow — prompts for each field and validates before writing (schema:
`scripts/lib/product-schema.mjs`). Full walkthrough, including editing an
existing entry and the validation rules: `docs/CATALOG-AUTHORING.md`.

1. `pnpm catalog:add` — title, subtitle, story, dimensions, materials, price,
   edition counts, images.
2. Drop product photos in `public/products/<slug>/`.
3. Create the Stripe product + price in the Stripe Dashboard.
4. Paste the resulting `price_xxx` in when prompted (or `pnpm catalog:add --
   --edit <slug>` after).
5. `pnpm check:launch` to catch placeholders before they ship.
6. Commit. Vercel rebuilds. Live.

## Sale flow

1. Visitor adds Forms to cart drawer (state in localStorage).
2. Checkout button POSTs cart to `/api/create-checkout-session`, which
   reserves each line's stock atomically in Upstash Redis (SETUP.md §4a; no
   store configured = static counts, no reservations) and 409s if any line ran out.
3. Stripe Checkout (hosted) handles payment + shipping address. The session
   expires after 30 minutes.
4. Stripe webhook → `/api/stripe-webhook`: `checkout.session.completed` posts
   to Discord (stock was already taken at step 2); `checkout.session.expired`
   releases the reservation. Both are idempotent by event id.
5. Storefront reads live counts from `GET /api/inventory`.
6. Stripe sends payment receipt email to buyer + Adrian.

## Hand-off / first-launch

See `SETUP.md` for the at-the-computer checklist (domain registration,
Stripe account, Discord webhook, Vercel project + DNS, photography).
