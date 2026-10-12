#!/usr/bin/env node
/**
 * add-product — guided authoring flow for data/products.json.
 *
 * Why this exists: hand-editing JSON is how a missing `alt`, a duplicate
 * slug, or `edition.remaining > edition.total` reaches the store. This
 * prompts for each field, builds the entry, validates it with the same
 * schema `check-launch-ready` enforces (`scripts/lib/product-schema.mjs`),
 * and refuses to write anything invalid.
 *
 * Usage:
 *   pnpm catalog:add                          # add a new product, interactively
 *   pnpm catalog:add -- --edit SLUG           # edit an existing product's fields
 *   pnpm catalog:add -- --from FILE.json      # add one product non-interactively
 *   pnpm catalog:add -- --from FILE.json --replace  # …or overwrite that slug
 *
 * `--from` is the agent path (the publish-product skill writes a draft entry
 * to a file and hands it here), so it goes through the exact same validation
 * as the prompts. It refuses to overwrite an existing slug unless `--replace`
 * is given — a slug collision is far more likely a mistake than an intent.
 *
 * Does not touch Stripe or photography — see docs/CATALOG-AUTHORING.md for
 * where those steps happen in the flow.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { validateProduct, validateCatalog, PRODUCT_STATUSES } from './lib/product-schema.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// `--catalog PATH` points at another file (tests use a temp copy, never the real catalog).
const catalogArg = process.argv.indexOf('--catalog');
const CATALOG_PATH =
  catalogArg !== -1 ? path.resolve(process.argv[catalogArg + 1]) : path.join(ROOT, 'data', 'products.json');

function loadCatalog() {
  const raw = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));
  return raw;
}

function saveCatalog(raw) {
  writeFileSync(CATALOG_PATH, JSON.stringify(raw, null, 2) + '\n', 'utf8');
}

async function ask(rl, question, { default: def, required = true } = {}) {
  const suffix = def !== undefined ? ` [${def}]` : '';
  while (true) {
    const answer = (await rl.question(`${question}${suffix}: `)).trim();
    if (answer) return answer;
    if (def !== undefined) return def;
    if (!required) return '';
    console.log('  (required — please enter a value)');
  }
}

async function askNumber(rl, question, { default: def } = {}) {
  while (true) {
    const raw = await ask(rl, question, { default: def !== undefined ? String(def) : undefined });
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
    console.log('  (please enter a number)');
  }
}

async function askList(rl, question) {
  const raw = await ask(rl, `${question} (comma-separated)`);
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

async function promptProduct(rl, existing) {
  console.log(existing ? `\nEditing "${existing.slug}" — press Enter to keep the current value.\n` : '\nNew product\n');

  const slug = existing?.slug ?? (await ask(rl, 'slug (kebab-case, e.g. monolith-02)'));
  const title = await ask(rl, 'title', { default: existing?.title });
  const subtitle = await ask(rl, 'subtitle', { default: existing?.subtitle });
  const story = await ask(rl, 'story', { default: existing?.story });
  const dimensions = await ask(rl, 'dimensions (e.g. 120 × 80 × 80 mm)', { default: existing?.dimensions });
  const weightLbs = await askNumber(rl, 'weightLbs', { default: existing?.weightLbs });
  const materials = existing?.materials?.length && !(await ask(rl, 'change materials? (y/N)', { default: 'n', required: false })).toLowerCase().startsWith('y')
    ? existing.materials
    : await askList(rl, 'materials');
  const priceUsd = await askNumber(rl, 'priceUsd', { default: existing?.priceUsd });
  const stripePriceId = await ask(rl, 'stripePriceId (from Stripe Dashboard; price_TODO_<slug> if not yet created)', {
    default: existing?.stripePriceId ?? `price_TODO_${slug.replace(/-/g, '_')}`,
  });
  const total = await askNumber(rl, 'edition.total', { default: existing?.edition?.total ?? 1 });
  const remaining = await askNumber(rl, 'edition.remaining', { default: existing?.edition?.remaining ?? total });
  const status = await ask(rl, `status (${PRODUCT_STATUSES.join('/')})`, { default: existing?.status ?? 'available' });

  const images = [];
  if (existing?.images?.length) {
    console.log(`  keeping ${existing.images.length} existing image(s); re-run with photos placed to add more (edit JSON directly for now).`);
    images.push(...existing.images);
  } else {
    console.log('  Add at least one image (empty src to stop):');
    for (let i = 0; ; i++) {
      const src = await ask(rl, `  image[${i}].src (e.g. /products/${slug}/01.jpg)`, { required: false, default: i === 0 ? undefined : '' });
      if (!src) break;
      const alt = await ask(rl, `  image[${i}].alt (describe THIS frame, not just the product name)`);
      images.push({ src, alt });
    }
  }

  const product = {
    slug,
    title,
    subtitle,
    story,
    dimensions,
    weightLbs,
    materials,
    priceUsd,
    stripePriceId,
    edition: { total, remaining },
    status,
    images,
  };
  if (existing?.artist) product.artist = existing.artist;

  return product;
}

/**
 * Validate `product` on its own and inside the resulting catalog, then write.
 * Returns true on success; prints every error and returns false otherwise.
 */
function commitProduct(raw, list, product, targetIndex) {
  const { ok, errors } = validateProduct(product);
  if (!ok) {
    console.error('\nadd-product: not written — this entry fails validation:\n');
    for (const e of errors) console.error(`  - ${e}`);
    return false;
  }

  const nextList = targetIndex === -1 ? [...list, product] : list.map((p, i) => (i === targetIndex ? product : p));
  const { ok: catalogOk, errors: catalogErrors } = validateCatalog(nextList);
  if (!catalogOk) {
    console.error('\nadd-product: not written — the resulting catalog fails validation:\n');
    for (const e of catalogErrors) console.error(`  - ${e}`);
    return false;
  }

  if (Array.isArray(raw)) {
    saveCatalog(nextList);
  } else {
    saveCatalog({ ...raw, products: nextList });
  }
  console.log(`\n✓ ${targetIndex === -1 ? 'added' : 'updated'} "${product.slug}" in ${path.relative(ROOT, CATALOG_PATH)}`);
  return true;
}

/** Non-interactive path: one product object from a JSON file. */
function addFromFile(raw, list, file, replace) {
  let product;
  try {
    product = JSON.parse(readFileSync(path.resolve(file), 'utf8'));
  } catch (e) {
    console.error(`add-product: could not read/parse ${file}: ${e.message}`);
    return false;
  }
  if (!product || typeof product !== 'object' || Array.isArray(product)) {
    console.error(`add-product: ${file} must contain a single product object`);
    return false;
  }

  const targetIndex = list.findIndex((p) => p.slug === product.slug);
  if (targetIndex !== -1 && !replace) {
    console.error(
      `add-product: not written — "${product.slug}" already exists.\n` +
        '  fix: pick a new slug, or pass --replace to overwrite the existing entry.',
    );
    return false;
  }
  return commitProduct(raw, list, product, targetIndex);
}

async function main() {
  const args = process.argv.slice(2);
  const editIdx = args.indexOf('--edit');
  const editSlug = editIdx !== -1 ? args[editIdx + 1] : null;
  const fromIdx = args.indexOf('--from');
  const fromFile = fromIdx !== -1 ? args[fromIdx + 1] : null;

  const raw = loadCatalog();
  const list = Array.isArray(raw) ? raw : (raw.products ?? []);

  if (fromFile) {
    if (!addFromFile(raw, list, fromFile, args.includes('--replace'))) process.exitCode = 1;
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    let product;
    let targetIndex = -1;

    if (editSlug) {
      targetIndex = list.findIndex((p) => p.slug === editSlug);
      if (targetIndex === -1) {
        console.error(`add-product: no product with slug "${editSlug}" in ${CATALOG_PATH}`);
        process.exitCode = 1;
        return;
      }
      product = await promptProduct(rl, list[targetIndex]);
    } else {
      product = await promptProduct(rl, null);
    }

    if (!commitProduct(raw, list, product, targetIndex)) {
      process.exitCode = 1;
      return;
    }
    console.log('  Next: drop photos in public/products/<slug>/, create the Stripe product/price if you used a price_TODO_ placeholder, then run `pnpm check:launch`.');
  } finally {
    rl.close();
  }
}

main();
