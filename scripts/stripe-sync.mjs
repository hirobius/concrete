#!/usr/bin/env node
/**
 * stripe-sync — makes Stripe match data/products.json, so nobody has to
 * click through the Dashboard to create a Product and a Price per figurine.
 *
 * For each product (or only `--slug <slug>`):
 *   1. find its Stripe Product by `metadata.slug` (list + filter in code — no
 *      dependency on the Search API, which is eventually consistent and is
 *      not enabled everywhere);
 *   2. create the Product if missing; update name/description if they drifted;
 *   3. make sure a USD Price of round(priceUsd * 100) is the product's
 *      default_price. Stripe prices are immutable, so a changed amount means a
 *      NEW price, set as default, with the old one archived (active: false);
 *   4. write the `price_…` id back into data/products.json.
 *
 * Idempotent: a second run with nothing changed creates and updates nothing.
 *
 * Dormant by default. With STRIPE_SECRET_KEY unset it prints one line and
 * exits 0, so wiring it into a pipeline before the key exists breaks nothing.
 *
 * Usage:
 *   pnpm stripe:sync                       # sync every product
 *   pnpm stripe:sync -- --slug form-01     # just one
 *   pnpm stripe:sync -- --dry-run          # print the plan; write nothing anywhere
 *   pnpm stripe:sync -- --confirm-live     # required to write with a LIVE key
 *
 * Environment (process.env only — this script never reads or writes .env*;
 * export the key in your shell for the run, or let your shell loader do it):
 *   STRIPE_SECRET_KEY   restricted key with Products + Prices write is enough
 *   SITE_URL            optional; with it, new Products get the absolute hero
 *                       image URL (falls back to VITE_SITE_URL, which the
 *                       checkout function already uses)
 *
 * Every error names the product and the fix, per scripts/check-launch-ready.mjs.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCatalog } from './lib/product-schema.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_CATALOG = path.join(ROOT, 'data', 'products.json');

const PAGE_SIZE = 100;

/**
 * A placeholder Stripe price id. Keep in step with PLACEHOLDER_PRICE in
 * scripts/check-launch-ready.mjs (the `stripe-price-ids` check) — whatever
 * that check calls a placeholder, this script replaces.
 */
const PLACEHOLDER_PRICE = /^price_(sample|TODO|test)|TODO/i;

export const isPlaceholderPriceId = (id) => !id || PLACEHOLDER_PRICE.test(id);

export const amountCents = (priceUsd) => Math.round(priceUsd * 100);

/** `sk_test_` / `rk_test_` -> test, `sk_live_` / `rk_live_` -> live, else null. */
export function keyMode(key) {
  if (/^[sr]k_test_/.test(key)) return 'test';
  if (/^[sr]k_live_/.test(key)) return 'live';
  return null;
}

// ── catalog text surgery ────────────────────────────────────────────────────
//
// The id is written back by editing the file's TEXT, not by JSON.parse +
// JSON.stringify. The catalog carries — / × escapes and long base64
// strings; a round-trip would rewrite every one of them and bury the one-line
// change this script makes in a diff nobody can review.

/** [start, end) offsets of each product object in the catalog text. */
export function locateProducts(text) {
  const ranges = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let stringStart = -1;
  let lastKeyAtRoot = null;
  let arrayDepth = null; // depth INSIDE the products array
  let rootIsArray = false;
  let open = -1;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') {
        inString = false;
        if (depth === 1 && !rootIsArray) lastKeyAtRoot = text.slice(stringStart + 1, i);
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      stringStart = i;
    } else if (c === '[' || c === '{') {
      depth++;
      if (depth === 1 && c === '[') {
        rootIsArray = true;
        arrayDepth = 1;
      } else if (c === '[' && depth === 2 && lastKeyAtRoot === 'products') {
        arrayDepth = 2;
      } else if (c === '{' && arrayDepth !== null && depth === arrayDepth + 1) {
        open = i;
      }
    } else if (c === '}' || c === ']') {
      if (c === '}' && arrayDepth !== null && depth === arrayDepth + 1 && open >= 0) {
        ranges.push([open, i + 1]);
        open = -1;
      }
      depth--;
    }
  }
  return ranges;
}

/**
 * Return `text` with product #`index`'s stripePriceId set to `id`, touching
 * nothing else. Throws (never returns a half-edit) if the result does not
 * parse to the same catalog with exactly that one value changed.
 */
export function setStripePriceId(text, index, id) {
  const ranges = locateProducts(text);
  const range = ranges[index];
  if (!range) throw new Error(`could not locate product #${index} in the catalog text`);
  const [start, end] = range;
  const body = text.slice(start, end);

  let next;
  const existing = /("stripePriceId"\s*:\s*)"(?:[^"\\]|\\.)*"/.exec(body);
  if (existing) {
    next = body.replace(existing[0], `${existing[1]}${JSON.stringify(id)}`);
  } else {
    // Missing key: insert directly after priceUsd, matching its indentation.
    const price = /^([ \t]*)"priceUsd"\s*:\s*[^,\n]+,?[ \t]*$/m.exec(body);
    if (!price) throw new Error('product has no stripePriceId and no priceUsd line to insert it after');
    const line = price[0].endsWith(',') ? price[0] : `${price[0]},`;
    next = body.replace(price[0], `${line}\n${price[1]}"stripePriceId": ${JSON.stringify(id)},`);
  }

  const out = text.slice(0, start) + next + text.slice(end);

  // Verify: same catalog, one value different.
  const before = JSON.parse(text);
  const after = JSON.parse(out);
  const listOf = (c) => (Array.isArray(c) ? c : c.products);
  const expected = JSON.parse(text);
  listOf(expected)[index].stripePriceId = id;
  // Key order is compared out of the check: inserting a missing key is
  // positioned by hand above, and what matters here is that no VALUE moved.
  const canon = (v) =>
    JSON.stringify(v, (_k, val) =>
      val && typeof val === 'object' && !Array.isArray(val)
        ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => (a < b ? -1 : 1)))
        : val,
    );
  if (canon(after) !== canon(expected) || listOf(before).length !== listOf(after).length) {
    throw new Error('refusing to write: the edit would have changed more than stripePriceId');
  }
  return out;
}

// ── sync ────────────────────────────────────────────────────────────────────

async function listAllProducts(client) {
  const all = [];
  let startingAfter;
  for (;;) {
    const page = await client.products.list({
      limit: PAGE_SIZE,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    all.push(...page.data);
    if (!page.has_more || page.data.length === 0) break;
    startingAfter = page.data[page.data.length - 1].id;
  }
  return all;
}

const idOf = (v) => (v && typeof v === 'object' ? v.id : v) ?? null;

function absoluteHero(product, siteUrl) {
  if (!siteUrl) return null;
  const src = product.images?.[0]?.src;
  if (typeof src !== 'string' || src.startsWith('data:')) return null;
  if (/^https?:\/\//i.test(src)) return src;
  return `${siteUrl.replace(/\/+$/, '')}/${src.replace(/^\/+/, '')}`;
}

function describeStripeError(err) {
  const msg = err?.message ?? String(err);
  if (err?.type === 'StripeAuthenticationError' || err?.statusCode === 401) {
    return {
      msg,
      fix: 'STRIPE_SECRET_KEY was rejected — check it is the full key for this account and mode (SETUP.md §3).',
    };
  }
  if (err?.type === 'StripePermissionError' || err?.statusCode === 403) {
    return {
      msg,
      fix: 'The key lacks permission — a restricted key needs Products: Write and Prices: Write (SETUP.md §3).',
    };
  }
  return {
    msg,
    fix: 'Fix the Stripe error above and re-run `pnpm stripe:sync -- --slug <slug>`; the run is idempotent, so nothing already created is duplicated.',
  };
}

/**
 * Sync the catalog against Stripe. Pure of process state: everything comes in
 * through arguments so tests can pass a fake client and a temp catalog.
 * Returns `{ ok, results }`; per-product failures do not stop the others.
 */
export async function syncCatalog({ client, catalogPath, slug, dryRun, siteUrl, log }) {
  const text = readFileSync(catalogPath, 'utf8');
  const raw = JSON.parse(text);
  const list = Array.isArray(raw) ? raw : (raw.products ?? []);

  // A product with no stripePriceId at all is something this script FIXES, so
  // it must not trip the schema's "stripePriceId is required".
  const { ok: schemaOk, errors } = validateCatalog(
    list.map((p) => ({ ...p, stripePriceId: p.stripePriceId || 'price_TODO' })),
  );
  if (!schemaOk) {
    log(`✗ ${path.relative(ROOT, catalogPath) || catalogPath} fails the product schema:`);
    for (const e of errors) log(`    ${e}`);
    log('  fix: correct the listed field(s) (`pnpm catalog:validate` prints the same report), then re-run.');
    return { ok: false, results: [] };
  }

  const targets = slug ? list.filter((p) => p.slug === slug) : list;
  if (slug && targets.length === 0) {
    log(`✗ ${slug}: no product with that slug in the catalog.`);
    log(`  fix: use one of: ${list.map((p) => p.slug).join(', ')}.`);
    return { ok: false, results: [] };
  }

  let stripeProducts;
  try {
    stripeProducts = await listAllProducts(client);
  } catch (err) {
    const { msg, fix } = describeStripeError(err);
    log(`✗ could not list Stripe products: ${msg}`);
    log(`  fix: ${fix}`);
    return { ok: false, results: [] };
  }
  const bySlug = new Map();
  for (const sp of stripeProducts) {
    const s = sp.metadata?.slug;
    if (!s) continue;
    // Prefer an active product if (somehow) there are two for one slug.
    if (!bySlug.has(s) || (sp.active && !bySlug.get(s).active)) bySlug.set(s, sp);
  }

  const results = [];
  for (const p of targets) {
    const index = list.indexOf(p);
    const steps = [];
    try {
      const wouldPrefix = dryRun ? 'would ' : '';
      const act = async (desc, fn) => {
        steps.push(desc);
        log(`    ${dryRun ? '~' : '+'} ${wouldPrefix}${desc}`);
        return dryRun ? null : fn();
      };
      const amount = amountCents(p.priceUsd);
      const label = `${p.slug} ($${(amount / 100).toFixed(2)})`;
      log(`  ${label}`);

      // 1. product
      let sp = bySlug.get(p.slug) ?? null;
      let spId = sp?.id ?? null;
      if (!sp) {
        const hero = absoluteHero(p, siteUrl);
        sp = await act(`create Product "${p.title}"${hero ? ' with hero image' : ''}`, () =>
          client.products.create({
            name: p.title,
            description: p.subtitle,
            metadata: { slug: p.slug },
            ...(hero ? { images: [hero] } : {}),
          }),
        );
        spId = sp?.id ?? null;
      } else {
        const patch = {};
        if (sp.name !== p.title) patch.name = p.title;
        if ((sp.description ?? '') !== p.subtitle) patch.description = p.subtitle;
        if (sp.active === false) patch.active = true;
        if (Object.keys(patch).length) {
          await act(`update Product ${sp.id}: ${Object.keys(patch).join(', ')}`, () =>
            client.products.update(sp.id, patch),
          );
        }
      }

      // 2. price
      const isUsable = (price) =>
        price &&
        price.active !== false &&
        price.currency === 'usd' &&
        price.unit_amount === amount &&
        spId !== null &&
        idOf(price.product) === spId;
      const fetchPrice = async (id) => {
        try {
          return await client.prices.retrieve(id);
        } catch (err) {
          if (err?.code === 'resource_missing' || err?.statusCode === 404) return null;
          throw err;
        }
      };

      const recorded = isPlaceholderPriceId(p.stripePriceId) ? null : p.stripePriceId;
      let current = recorded ? await fetchPrice(recorded) : null;
      // Not recorded (or recorded price is stale)? The product may already
      // carry a correct default price — adopt it rather than minting a twin.
      // This is also what makes a run safe to repeat after a failed disk write.
      let adopted = false;
      if (!isUsable(current) && spId && sp?.default_price) {
        const dflt = await fetchPrice(idOf(sp.default_price));
        if (isUsable(dflt)) {
          current = dflt;
          adopted = true;
        }
      }

      let finalId;
      if (isUsable(current)) {
        finalId = current.id;
        if (idOf(sp?.default_price) !== current.id) {
          await act(`set ${current.id} as default price of ${spId}`, () =>
            client.products.update(spId, { default_price: current.id }),
          );
        }
        if (adopted || recorded !== current.id) {
          await act(`record ${current.id} in data/products.json`, async () => {
            writeFileSync(catalogPath, setStripePriceId(readFileSync(catalogPath, 'utf8'), index, current.id));
          });
        }
      } else {
        const why = !recorded
          ? 'no real price id recorded'
          : !current
            ? `${recorded} not found in this Stripe account/mode`
            : current.unit_amount !== amount
              ? `${recorded} is ${current.unit_amount}¢, catalog says ${amount}¢`
              : `${recorded} is archived, not USD, or belongs to another product`;
        const created = await act(`create USD Price ${amount}¢ (${why})`, () =>
          client.prices.create({
            product: spId,
            currency: 'usd',
            unit_amount: amount,
            metadata: { slug: p.slug },
          }),
        );
        finalId = dryRun ? '<new price>' : created.id;
        // Default first: Stripe refuses to archive a product's default price.
        await act(`set ${finalId} as default price of ${spId ?? '<new product>'}`, () =>
          client.products.update(spId, { default_price: finalId }),
        );
        await act(`record ${finalId} in data/products.json`, async () => {
          writeFileSync(catalogPath, setStripePriceId(readFileSync(catalogPath, 'utf8'), index, finalId));
        });
        // Archive the replaced price, only when it is ours to archive.
        const old = current && current.active !== false && idOf(current.product) === spId ? current : null;
        const oldDefault = idOf(sp?.default_price);
        const toArchive = [old?.id, oldDefault && oldDefault !== old?.id ? oldDefault : null].filter(Boolean);
        for (const oldId of toArchive) {
          if (oldId === finalId) continue;
          const oldPrice = oldId === old?.id ? old : await fetchPrice(oldId);
          if (oldPrice && oldPrice.active !== false && idOf(oldPrice.product) === spId) {
            await act(`archive old price ${oldId}`, () => client.prices.update(oldId, { active: false }));
          }
        }
      }

      if (steps.length === 0) log(`    ✓ up to date${finalId ? ` (${finalId})` : ''}`);
      results.push({ slug: p.slug, ok: true, steps });
    } catch (err) {
      const { msg, fix } = describeStripeError(err);
      log(`    ✗ ${p.slug}: ${msg}`);
      log(`      fix: ${fix}`);
      results.push({ slug: p.slug, ok: false, steps, error: msg });
    }
  }

  return { ok: results.every((r) => r.ok), results };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

/**
 * Returns the process exit code. `createClient(key)` is injectable so tests
 * never need the network (or the real `stripe` package).
 */
export async function main({
  argv = process.argv.slice(2),
  env = process.env,
  createClient = async (key) => new (await import('stripe')).default(key),
  catalogPath = DEFAULT_CATALOG,
  log = console.log,
} = {}) {
  const dryRun = argv.includes('--dry-run');
  const confirmLive = argv.includes('--confirm-live');
  const slugIdx = argv.indexOf('--slug');
  const slug = slugIdx >= 0 ? argv[slugIdx + 1] : undefined;
  if (slugIdx >= 0 && (!slug || slug.startsWith('--'))) {
    log('✗ --slug needs a value.');
    log('  fix: pass a product slug from data/products.json, e.g. `pnpm stripe:sync -- --slug form-01`.');
    return 1;
  }

  const key = env.STRIPE_SECRET_KEY;
  if (!key) {
    log('stripe-sync: skipped — STRIPE_SECRET_KEY not set (see SETUP.md §3)');
    return 0;
  }

  const mode = keyMode(key);
  if (!mode) {
    log('✗ STRIPE_SECRET_KEY is not a recognisable Stripe secret/restricted key (expected sk_test_…, sk_live_…, rk_test_… or rk_live_…).');
    log('  fix: copy the key from https://dashboard.stripe.com/apikeys — never a publishable (pk_) key.');
    return 1;
  }

  if (mode === 'live') {
    log('╔══════════════════════════════════════════════════════════╗');
    log('║  stripe-sync: *** LIVE MODE *** — real Stripe account    ║');
    log('╚══════════════════════════════════════════════════════════╝');
  } else {
    log('stripe-sync: TEST mode (test-mode key; nothing here touches live data)');
  }
  if (dryRun) log('stripe-sync: --dry-run — plan only; nothing is written to Stripe or to disk');

  if (mode === 'live' && !dryRun && !confirmLive) {
    log('✗ refusing to write with a LIVE key without --confirm-live.');
    log('  fix: preview with `pnpm stripe:sync -- --dry-run`, then re-run with `--confirm-live` once the plan is what you expect.');
    return 1;
  }

  const siteUrl = env.SITE_URL || env.VITE_SITE_URL || '';
  let client;
  try {
    client = await createClient(key);
  } catch (err) {
    log(`✗ could not create the Stripe client: ${err.message}`);
    log('  fix: run `pnpm install` (the `stripe` package is a dependency), then re-run.');
    return 1;
  }

  log('');
  const { ok, results } = await syncCatalog({ client, catalogPath, slug, dryRun, siteUrl, log });
  log('');
  if (ok) {
    const touched = results.filter((r) => r.steps.length).length;
    log(
      `stripe-sync: ${dryRun ? 'plan complete' : 'done'} — ${results.length} product(s), ${touched} ${dryRun ? 'would change' : 'changed'}, ${results.length - touched} up to date.`,
    );
  } else {
    log('stripe-sync: ✗ finished with errors (see above). Successful products were still written.');
  }
  return ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(`stripe-sync: unexpected failure — ${err.stack ?? err}`);
      process.exit(1);
    },
  );
}
