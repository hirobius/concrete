# HDS adoption — the intended architecture

_Decision recorded 2026-10-12 (Adrian)._

## The rule

This storefront is built **on the Hirobius Design System (HDS)** at the **token
layer**, and deliberately **not** at the component layer.

1. **Everything rendered derives from HDS tokens.** Every color, type size,
   radius, and spacing value resolves to an HDS token — `@hirobius/design-system`
   is a real dependency; `src/styles/globals.css` imports its `variables.css`,
   and `tailwind.config.ts` binds every Tailwind color/font/size/radius to a
   `var(--semantic-*)` / `var(--primitive-*)` custom property. No raw color
   literal may appear in `src/`.
2. **Components are bespoke on purpose.** HDS is meant to be *scalable and
   extendable*. We do **not** force these layouts into HDS's component set
   (`Button`, `Card`, `Dialog`, …). Hand-rolled components styled entirely from
   HDS tokens are the sanctioned pattern here — the storefront's layout is its
   own, and extends HDS rather than being constrained by it.

So "on HDS" here means **tokens + discipline**, not component adoption.

## Why

Adrian, 2026-10-12: _"I don't wanna break the layouts. The HDS system is intended
to be scalable and extendable, so don't force the layout to use our limited
selection of components, but under the hood, anything rendered on the page should
definitely come from HDS tokens."_

Forcing a distinctive storefront into a shared component library trades away the
layout's identity for uniformity we don't want, and couples a client site to the
library's component API churn. Binding to the **token layer** keeps the identity
free while guaranteeing the site stays visually consistent with HDS and re-skins
cleanly (the brand delta lives in `tenant/tokens.json`).

## The brand delta

Brand-specific color values are **not** hand-written into components. They live in
`tenant/tokens.json` and are compiled to `src/styles/tenant-overlay.generated.css`
by `scripts/generate-tenant-overlay.mjs` (`pnpm tokens:overlay`), layered over the
HDS base. That generated file is the **only** place in `src/` allowed to carry raw
color values; `pnpm tokens:check` verifies it is in sync.

## How it's enforced

| Invariant | Gate | Where |
|---|---|---|
| No raw color in `src/` (everything token-derived) | `pnpm tokens:discipline` → `scripts/check-token-discipline.mjs` | CI (`ci.yml`), hard-fail |
| Brand overlay matches `tenant/tokens.json` | `pnpm tokens:check` | CI, hard-fail |
| App renders without crashing (desktop + mobile) | `pnpm test:e2e` | CI (`e2e.yml`) |

If a future change needs a color that isn't an HDS token, the answer is to add it
to the brand overlay (`tenant/tokens.json`) or upstream to HDS — never a literal in
a component. The token-discipline gate will block the literal.

## If component adoption is ever reconsidered

An HDS-component migration was audited and deferred (see this decision). Should it
be revisited, the safe, low-visual-risk starting points are `Button`, `Badge`, and
`HdsThemeProvider`; the signature `ProductCard` is highest-risk and would need
design review. Note the peer-dependency skew: HDS targets `react-router@7` /
`react@18–19` while this app pins `react-router-dom@6`, so router-aware HDS
components (`NavItem`, links via `HdsRouterProvider`) need a v6 compatibility check
before use. None of this is required for the current token-layer architecture.
