# Publishing a new piece

Your part is three steps, all doable from your phone. A Claude session does
everything in between: processing the photos, writing the copy, the catalog
entry, the Stripe price, checks, and a preview. That session follows
`.claude/skills/publish-product/SKILL.md`.

## 1. Shoot

- Shoot as many angles as you like. A **straight-on shot of the whole piece on
  a plain background** makes the best card image. Leave a little space above
  and below: the card crops to a tall 4:5 frame.
- Any phone format is fine. HEIC (the iPhone default), JPEG, and PNG all work,
  and rotation is handled for you.
- Location data in your photos is stripped before anything is published.

## 2. Drop them in Drive

In Google Drive, open **Concrete → New** and:

1. Make a folder for the piece. Name it whatever you call the piece; a working
   name is fine.
2. Upload the photos into it.
3. Copy the **`_Template — copy into each piece`** doc into the folder and fill
   in the four facts:

   | Fact | Example |
   |---|---|
   | Dimensions | 120 × 80 × 80 mm |
   | Weight | 2.1 lbs |
   | Price | $88 |
   | Edition size | 24 |

   Everything else in the template is optional: a name, materials (blank means
   the same as your last piece), anything you want said about it, which photo
   should be the hero, and the maker and their split if it isn't yours.

   No time for the doc? Put the facts in the folder name instead:
   `River Stone 02 — 120x80x80mm, 2.1lb, $88, ed 24`.

## 3. Say "publish the new piece"

…in any Claude session on this repo. You'll get back a **preview link to the
product page**, plus the drafted title, story, and photo descriptions to read.

- Reply **"ship it"** and merge the PR. It goes live.
- Or reply with changes ("shorter story", "use the side shot as the hero",
  "price is $96"), and you'll get a new preview.

When it's live, the folder moves to **Concrete → Published**.

## What Claude won't do without you

- **Make up a fact.** If a price, size, weight, or edition size is missing,
  you'll be asked.
- **Put anything live.** Merging the PR is always your call.
- **Charge in live mode.** Creating a live Stripe price waits for your
  go-ahead. Until a Stripe key is set (see `SETUP.md` §3), a new piece shows on
  the site but its checkout stays blocked, and the PR says so.

## Under the hood

| Step | Tool |
|---|---|
| Drive photo → pipeline source (HEIC → JPEG, rotation, metadata stripped) | `pnpm photos:intake` (`scripts/intake-photo.mjs`) |
| Source → web images (card crop, gallery, link-preview crop) | `pnpm photos` (`scripts/process-product-photos.mjs`; see `docs/PRODUCT-IMAGES.md`) |
| Draft entry → validated catalog entry | `pnpm catalog:add -- --from <file>` (see `docs/CATALOG-AUTHORING.md`) |
| Catalog → Stripe product + price | `pnpm stripe:sync` |
| Live stock after each sale | `api/_lib/inventory.mjs` (see `SETUP.md`) |
