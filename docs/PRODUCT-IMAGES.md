# Product images: raw photo → card-ready asset

How a shot of a piece becomes the files the storefront actually serves.
Real photography is a separate, human step (#4) — this doc is the pipeline
that runs once photos exist, and the `photos-src/` folder starts empty.

## Convention

**Source** (gitignored — lives only on the machine that shot it, not
committed as final art, kept there for re-derivation if a derivative needs
to be regenerated):

```
photos-src/<slug>/NN-<angle>.jpg
```

- `<slug>` matches the product's `slug` in `data/products.json`.
- `NN` — two-digit sequence (`01`, `02`, …), lowest number is the hero shot.
- `<angle>` — short, free-text (`front`, `side`, `detail`, `back`, `top`, …).
- Format: whatever comes off the camera (`.jpg` typically). The script
  accepts any format `sharp` can read.

Example: `photos-src/river-stone-planter/01-front.jpg`

**Output** (what ships, under `public/products/<slug>/`):

| File | Size | Use |
|---|---|---|
| `NN-<angle>-600.webp` | 600px max edge | not wired into the storefront yet — generated ahead of a future thumbnail/srcset pass; drop from the pipeline if that never lands |
| `NN-<angle>-1200.webp` | 1200px max edge | secondary gallery images — `images[1+].src` on the product page |
| `main-1200x1500.webp` | 1200×1500, cover-cropped (4:5, matching the `aspect-[4/5]` card/product frame) | the hero asset — `images[0].src` |
| `og-1200x630.webp` | 1200×630, cover-cropped | social share / `<meta og:image>` |

Example, for the source above:

```
public/products/river-stone-planter/01-front-600.webp
public/products/river-stone-planter/01-front-1200.webp
public/products/river-stone-planter/02-side-600.webp
public/products/river-stone-planter/02-side-1200.webp
public/products/river-stone-planter/main-1200x1500.webp
public/products/river-stone-planter/og-1200x630.webp
```

`main-1200x1500.webp` and `og-1200x630.webp` are both derived from the `01`
(lowest-numbered) source photo — the hero shot supplies both the card's main
image and the social-share crop.

## Wiring into the catalog

`images[]` (see `docs/CATALOG-AUTHORING.md`) is `{src, alt}[]` — one `src`
per entry, no srcset, so each entry names exactly one file:

- `images[0].src` — always `main-1200x1500.webp`. `primaryImage()` in
  `src/lib/products.ts` reads `images[0]`, and both `ProductCard` and the
  main product-page frame render it at `aspect-[4/5]`, which is the crop
  this file is cut to. No separate "primary image" field to keep in sync.
- `images[1+].src` — the `-1200` webp for each additional angle you want in
  the gallery, in display order (`photos-src/<slug>/02-side-1200.webp`, …).
  The `-600` derivative isn't referenced by any `images[]` entry (see the
  output table above).

`og-1200x630.webp` isn't part of `images[]` at all — it's a fixed filename
a future share-meta component reads directly by convention
(`/products/<slug>/og-1200x630.webp`).

## Running it

```bash
pnpm photos <slug>       # process one product's source photos
pnpm photos --all        # process every folder under photos-src/
```

Requires `photos-src/<slug>/` to contain at least one `NN-<angle>.<ext>`
file. Output folder is created if missing; re-running overwrites that
product's derivatives (safe to re-run after reshoots).

Script: `scripts/process-product-photos.mjs`. Uses `sharp` (devDependency —
build-time only, never ships to the client bundle).
