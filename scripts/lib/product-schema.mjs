#!/usr/bin/env node
/**
 * product-schema — plain-JS validator for the `Product` type
 * (`src/lib/products.ts`). No dependencies: this is the same runtime that
 * ships the site, so a schema library would be one more thing to keep in
 * sync with `products.ts` by hand. The doc comments here ARE the schema.
 *
 * Used by:
 *  - `scripts/check-launch-ready.mjs` (the `product-schema` check) — refuses
 *    to call the catalog launch-ready while an entry is malformed.
 *  - `scripts/add-product.mjs` (the guided authoring flow) — refuses to
 *    write an entry that would fail here.
 *  - `pnpm test:products` — unit tests in `product-schema.test.mjs`.
 *
 * Usage as a CLI:
 *   node scripts/lib/product-schema.mjs [path/to/products.json]
 *   (defaults to data/products.json; exits 1 on any invalid product)
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PRODUCT_STATUSES = ['available', 'sold-out', 'archived'];

const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const STRIPE_PRICE_ID = /^price_/;

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Validate one product. Does NOT check slug uniqueness — that requires
 * seeing the rest of the catalog, which `validateCatalog` provides.
 * Returns `{ ok, errors }`; `errors` is empty when `ok` is true.
 */
export function validateProduct(product, { path: at = '' } = {}) {
  const errors = [];
  const err = (msg) => errors.push(at ? `${at}: ${msg}` : msg);

  if (product === null || typeof product !== 'object') {
    return { ok: false, errors: [at ? `${at}: not an object` : 'not an object'] };
  }

  // slug
  if (!isNonEmptyString(product.slug)) {
    err('slug is required and must be a non-empty string');
  } else if (!KEBAB_CASE.test(product.slug)) {
    err(`slug "${product.slug}" must be kebab-case (lowercase letters, digits, hyphens; no leading/trailing/double hyphens)`);
  }

  // required strings
  for (const field of ['title', 'subtitle', 'story', 'dimensions']) {
    if (!isNonEmptyString(product[field])) err(`${field} is required and must be a non-empty string`);
  }

  // materials
  if (!Array.isArray(product.materials) || product.materials.length === 0) {
    err('materials must be a non-empty array of strings');
  } else {
    product.materials.forEach((m, i) => {
      if (!isNonEmptyString(m)) err(`materials[${i}] must be a non-empty string`);
    });
  }

  // priceUsd
  if (!isFiniteNumber(product.priceUsd) || product.priceUsd <= 0) {
    err(`priceUsd must be a number > 0 (got ${JSON.stringify(product.priceUsd)})`);
  }

  // stripePriceId
  if (!isNonEmptyString(product.stripePriceId)) {
    err('stripePriceId is required and must be a non-empty string');
  } else if (!STRIPE_PRICE_ID.test(product.stripePriceId)) {
    err(`stripePriceId "${product.stripePriceId}" must start with "price_"`);
  }

  // edition
  const edition = product.edition;
  if (edition === null || typeof edition !== 'object') {
    err('edition is required and must be an object with { total, remaining }');
  } else {
    const { total, remaining } = edition;
    if (!isFiniteNumber(total) || !Number.isInteger(total) || total < 0) {
      err(`edition.total must be a non-negative integer (got ${JSON.stringify(total)})`);
    }
    if (!isFiniteNumber(remaining) || !Number.isInteger(remaining) || remaining < 0) {
      err(`edition.remaining must be a non-negative integer (got ${JSON.stringify(remaining)})`);
    }
    if (isFiniteNumber(total) && isFiniteNumber(remaining) && remaining > total) {
      err(`edition.remaining (${remaining}) must be <= edition.total (${total})`);
    }
  }

  // status
  if (!PRODUCT_STATUSES.includes(product.status)) {
    err(`status must be one of ${PRODUCT_STATUSES.join(', ')} (got ${JSON.stringify(product.status)})`);
  }

  // images
  if (!Array.isArray(product.images) || product.images.length === 0) {
    err('images must be a non-empty array of { src, alt }');
  } else {
    product.images.forEach((img, i) => {
      if (img === null || typeof img !== 'object') {
        err(`images[${i}] must be an object with { src, alt }`);
        return;
      }
      if (!isNonEmptyString(img.src)) err(`images[${i}].src is required and must be a non-empty string`);
      if (!isNonEmptyString(img.alt)) err(`images[${i}].alt is required and must be a non-empty string (per-image, describing that frame)`);
    });
  }

  // artist (optional)
  if (product.artist !== undefined) {
    const artist = product.artist;
    if (artist === null || typeof artist !== 'object') {
      err('artist, if present, must be an object');
    } else {
      if (!isNonEmptyString(artist.slug)) err('artist.slug is required and must be a non-empty string');
      if (!isNonEmptyString(artist.name)) err('artist.name is required and must be a non-empty string');
      if (!isFiniteNumber(artist.splitPercent) || artist.splitPercent < 0 || artist.splitPercent > 100) {
        err(`artist.splitPercent must be a number between 0 and 100 (got ${JSON.stringify(artist.splitPercent)})`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Validate a whole catalog (array of products): every product individually,
 * plus slug uniqueness across the set.
 */
export function validateCatalog(products) {
  const errors = [];

  if (!Array.isArray(products)) {
    return { ok: false, errors: ['catalog must be an array of products'] };
  }

  const seenSlugs = new Map(); // slug -> first index
  products.forEach((product, i) => {
    const { errors: productErrors } = validateProduct(product, { path: `products[${i}]${isNonEmptyString(product?.slug) ? ` (${product.slug})` : ''}` });
    errors.push(...productErrors);

    if (isNonEmptyString(product?.slug)) {
      if (seenSlugs.has(product.slug)) {
        errors.push(`products[${i}]: slug "${product.slug}" duplicates products[${seenSlugs.get(product.slug)}]`);
      } else {
        seenSlugs.set(product.slug, i);
      }
    }
  });

  return { ok: errors.length === 0, errors };
}

// --- CLI -------------------------------------------------------------------

function isMain() {
  return process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
}

if (isMain()) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const target = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'data', 'products.json');
  let raw;
  try {
    raw = JSON.parse(readFileSync(target, 'utf8'));
  } catch (e) {
    console.error(`product-schema: could not read/parse ${target}: ${e.message}`);
    process.exit(1);
  }
  const list = Array.isArray(raw) ? raw : (raw.products ?? []);
  const { ok, errors } = validateCatalog(list);
  if (ok) {
    console.log(`product-schema: ${list.length} product(s), all valid (${target})`);
    process.exit(0);
  }
  console.error(`product-schema: ${errors.length} error(s) in ${target}\n`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
