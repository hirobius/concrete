import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateProduct, validateCatalog, PRODUCT_STATUSES } from './product-schema.mjs';

function validProduct(overrides = {}) {
  return {
    slug: 'monolith-01',
    title: 'Monolith 01',
    subtitle: 'Cast concrete object',
    story: 'A hand-poured monolith.',
    dimensions: '120 × 80 × 80 mm',
    weightLbs: 2.1,
    materials: ['GFRC concrete', 'mineral sealer'],
    priceUsd: 88,
    stripePriceId: 'price_live_monolith01',
    edition: { total: 24, remaining: 11 },
    status: 'available',
    images: [{ src: '/products/monolith-01/01.jpg', alt: 'Monolith 01 straight on' }],
    ...overrides,
  };
}

test('a well-formed product is valid', () => {
  const { ok, errors } = validateProduct(validProduct());
  assert.equal(ok, true);
  assert.deepEqual(errors, []);
});

test('rejects a non-object', () => {
  const { ok, errors } = validateProduct(null);
  assert.equal(ok, false);
  assert.ok(errors.length > 0);
});

test('slug must be kebab-case', () => {
  for (const bad of ['Monolith_01', 'Monolith 01', 'monolith--01', '-monolith', 'monolith-', 'MONOLITH']) {
    const { ok, errors } = validateProduct(validProduct({ slug: bad }));
    assert.equal(ok, false, `expected "${bad}" to be rejected`);
    assert.ok(errors.some((e) => e.includes('kebab-case')), `expected a kebab-case error for "${bad}", got: ${errors}`);
  }
});

test('slug is required', () => {
  const { ok, errors } = validateProduct(validProduct({ slug: '' }));
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes('slug')));
});

test('required strings cannot be blank', () => {
  for (const field of ['title', 'subtitle', 'story', 'dimensions']) {
    const { ok, errors } = validateProduct(validProduct({ [field]: '   ' }));
    assert.equal(ok, false, `expected ${field} to be rejected when blank`);
    assert.ok(errors.some((e) => e.includes(field)));
  }
});

test('materials must be a non-empty array of non-empty strings', () => {
  assert.equal(validateProduct(validProduct({ materials: [] })).ok, false);
  assert.equal(validateProduct(validProduct({ materials: ['ok', ''] })).ok, false);
  assert.equal(validateProduct(validProduct({ materials: 'concrete' })).ok, false);
});

test('priceUsd must be > 0', () => {
  assert.equal(validateProduct(validProduct({ priceUsd: 0 })).ok, false);
  assert.equal(validateProduct(validProduct({ priceUsd: -5 })).ok, false);
  assert.equal(validateProduct(validProduct({ priceUsd: 'free' })).ok, false);
  assert.equal(validateProduct(validProduct({ priceUsd: 0.01 })).ok, true);
});

test('stripePriceId must start with price_', () => {
  const { ok, errors } = validateProduct(validProduct({ stripePriceId: 'sample_monolith01' }));
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes('price_')));
});

test('edition.remaining must not exceed edition.total', () => {
  const { ok, errors } = validateProduct(validProduct({ edition: { total: 5, remaining: 6 } }));
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes('remaining')));
});

test('edition values must be non-negative integers', () => {
  assert.equal(validateProduct(validProduct({ edition: { total: -1, remaining: 0 } })).ok, false);
  assert.equal(validateProduct(validProduct({ edition: { total: 5, remaining: -1 } })).ok, false);
  assert.equal(validateProduct(validProduct({ edition: { total: 5.5, remaining: 1 } })).ok, false);
});

test('status must be an allowed value', () => {
  for (const status of PRODUCT_STATUSES) {
    assert.equal(validateProduct(validProduct({ status })).ok, true);
  }
  assert.equal(validateProduct(validProduct({ status: 'discontinued' })).ok, false);
});

test('images must be non-empty, each with src and alt', () => {
  assert.equal(validateProduct(validProduct({ images: [] })).ok, false);
  assert.equal(validateProduct(validProduct({ images: [{ src: '/a.jpg', alt: '' }] })).ok, false);
  assert.equal(validateProduct(validProduct({ images: [{ src: '', alt: 'x' }] })).ok, false);
  assert.equal(validateProduct(validProduct({ images: [{ alt: 'no src' }] })).ok, false);
});

test('artist is optional, but splitPercent must be 0-100 when present', () => {
  assert.equal(validateProduct(validProduct()).ok, true); // no artist at all
  const base = { slug: 'maker', name: 'A Maker' };
  assert.equal(validateProduct(validProduct({ artist: { ...base, splitPercent: 0 } })).ok, true);
  assert.equal(validateProduct(validProduct({ artist: { ...base, splitPercent: 100 } })).ok, true);
  assert.equal(validateProduct(validProduct({ artist: { ...base, splitPercent: 50.5 } })).ok, true);
  assert.equal(validateProduct(validProduct({ artist: { ...base, splitPercent: -1 } })).ok, false);
  assert.equal(validateProduct(validProduct({ artist: { ...base, splitPercent: 101 } })).ok, false);
  assert.equal(validateProduct(validProduct({ artist: { splitPercent: 10 } })).ok, false); // missing slug/name
});

test('validateCatalog validates every product and rejects duplicate slugs', () => {
  const catalog = [validProduct({ slug: 'a' }), validProduct({ slug: 'a' })];
  const { ok, errors } = validateCatalog(catalog);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes('duplicates')));
});

test('validateCatalog passes a catalog of distinct valid products', () => {
  const catalog = [validProduct({ slug: 'a' }), validProduct({ slug: 'b' })];
  const { ok, errors } = validateCatalog(catalog);
  assert.equal(ok, true);
  assert.deepEqual(errors, []);
});

test('validateCatalog rejects a non-array', () => {
  const { ok } = validateCatalog({ products: [] });
  assert.equal(ok, false);
});

test('the real data/products.json validates clean', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const path = await import('node:path');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const raw = JSON.parse(readFileSync(path.join(root, 'data', 'products.json'), 'utf8'));
  const { ok, errors } = validateCatalog(raw.products);
  assert.equal(ok, true, `expected data/products.json to validate clean, got: ${errors.join('; ')}`);
});
