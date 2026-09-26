# Product images: raw photo → card-ready asset

How a shot of a piece becomes the files the storefront actually serves.
Real photography is a separate, human step (#4) — this doc is the pipeline
that runs once photos exist, and the `photos-src/` folder starts empty.

## Convention

**Source** (not committed as final art, but kept for re-derivation):

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
| `NN-<angle>-600.webp` | 600px max edge | small/thumbnail card grid |
| `NN-<angle>-1200.webp` | 1200px max edge | full-size gallery view |
| `main-1200x1500.webp` | 1200×1500, cover-cropped | the hero asset — `images[0].src` |
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

Point `images[].src` (see `docs/CATALOG-AUTHORING.md`) at the `-600`/`-1200`
webp pair(s) you want in the gallery, in the order they should appear —
first entry is the hero (`primaryImage()` in `src/lib/products.ts` reads
`images[0]`, so no separate "primary image" field to keep in sync). The
`main-1200x1500` and `og-1200x630` derivatives aren't part of `images[]`;
they're fixed filenames a future card/share-meta component can reference
directly by convention (`/products/<slug>/main-1200x1500.webp`).

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
