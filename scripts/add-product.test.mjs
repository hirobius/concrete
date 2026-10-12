import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'add-product.mjs');

function draft(overrides = {}) {
  return {
    slug: 'test-piece-01',
    title: 'Test Piece 01',
    subtitle: 'Cast concrete object',
    story: 'A hand-poured test piece.',
    dimensions: '100 × 60 × 60 mm',
    weightLbs: 1.5,
    materials: ['GFRC concrete'],
    priceUsd: 64,
    stripePriceId: 'price_TODO_test_piece_01',
    edition: { total: 12, remaining: 12 },
    status: 'available',
    images: [{ src: '/products/test-piece-01/main-1200x1500.webp', alt: 'Test piece, front' }],
    ...overrides,
  };
}

/** A temp workspace holding a copy of the real catalog plus a draft file. */
function workspace(product) {
  const dir = mkdtempSync(path.join(tmpdir(), 'add-product-'));
  const catalog = path.join(dir, 'products.json');
  copyFileSync(path.join(ROOT, 'data', 'products.json'), catalog);
  const file = path.join(dir, 'draft.json');
  writeFileSync(file, JSON.stringify(product));
  return { catalog, file };
}

const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
const slugs = (catalog) => {
  const raw = JSON.parse(readFileSync(catalog, 'utf8'));
  return (Array.isArray(raw) ? raw : raw.products).map((p) => p.slug);
};

test('--from adds a valid product without prompting', () => {
  const { catalog, file } = workspace(draft());
  const r = run('--catalog', catalog, '--from', file);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(slugs(catalog).includes('test-piece-01'));
});

test('--from refuses to overwrite an existing slug without --replace', () => {
  const { catalog, file } = workspace(draft());
  assert.equal(run('--catalog', catalog, '--from', file).status, 0);
  const before = readFileSync(catalog, 'utf8');
  const r = run('--catalog', catalog, '--from', file);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /already exists/);
  assert.equal(readFileSync(catalog, 'utf8'), before);
});

test('--from --replace overwrites that slug in place', () => {
  const { catalog, file } = workspace(draft());
  assert.equal(run('--catalog', catalog, '--from', file).status, 0);
  writeFileSync(file, JSON.stringify(draft({ priceUsd: 72 })));
  const r = run('--catalog', catalog, '--from', file, '--replace');
  assert.equal(r.status, 0, r.stderr);
  const raw = JSON.parse(readFileSync(catalog, 'utf8'));
  const list = Array.isArray(raw) ? raw : raw.products;
  assert.equal(list.filter((p) => p.slug === 'test-piece-01').length, 1);
  assert.equal(list.find((p) => p.slug === 'test-piece-01').priceUsd, 72);
});

test('--from writes nothing when the draft is invalid', () => {
  const { catalog, file } = workspace(draft({ images: [{ src: '/x.webp', alt: '' }] }));
  const before = readFileSync(catalog, 'utf8');
  const r = run('--catalog', catalog, '--from', file);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /fails validation/);
  assert.equal(readFileSync(catalog, 'utf8'), before);
});
