import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {
  parseSourceFilename,
  planSources,
  planOutputs,
  processProduct,
} from './process-product-photos.mjs';

// --- pure parsing/planning ---------------------------------------------

test('parseSourceFilename accepts NN-angle.ext', () => {
  assert.deepEqual(parseSourceFilename('01-front.jpg'), {
    seq: '01',
    angle: 'front',
    ext: 'jpg',
    filename: '01-front.jpg',
  });
});

test('parseSourceFilename accepts a multi-word angle', () => {
  const parsed = parseSourceFilename('02-three-quarter.png');
  assert.equal(parsed.angle, 'three-quarter');
});

test('parseSourceFilename rejects non-matching names', () => {
  for (const bad of ['front.jpg', '1-front.jpg', 'readme.md', '.DS_Store', '01-front']) {
    assert.equal(parseSourceFilename(bad), null, `expected "${bad}" to be rejected`);
  }
});

test('planSources sorts by sequence and drops non-matching files', () => {
  const sources = planSources(['02-side.jpg', '01-front.jpg', 'readme.md', '10-back.jpg']);
  assert.deepEqual(sources.map((s) => s.filename), ['01-front.jpg', '02-side.jpg', '10-back.jpg']);
});

test('planOutputs: one source produces 4 files, hero-derived main+og included', () => {
  const outputs = planOutputs(planSources(['01-front.jpg']));
  assert.deepEqual(outputs, [
    '01-front-600.webp',
    '01-front-1200.webp',
    'main-1200x1500.webp',
    'og-1200x630.webp',
  ]);
});

test('planOutputs: multiple sources each get a pair, main/og only once', () => {
  const outputs = planOutputs(planSources(['01-front.jpg', '02-side.jpg']));
  assert.deepEqual(outputs, [
    '01-front-600.webp',
    '01-front-1200.webp',
    '02-side-600.webp',
    '02-side-1200.webp',
    'main-1200x1500.webp',
    'og-1200x630.webp',
  ]);
});

test('planOutputs: no sources produces nothing', () => {
  assert.deepEqual(planOutputs([]), []);
});

// --- integration: real sharp pipeline against a synthetic image --------

async function withTempDirs(fn) {
  const root = await mkdtemp(path.join(tmpdir(), 'photos-test-'));
  const sourceRoot = path.join(root, 'photos-src');
  const outputRoot = path.join(root, 'public', 'products');
  try {
    await fn({ root, sourceRoot, outputRoot });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function makeSyntheticJpeg(filePath, { width = 2000, height = 1500 } = {}) {
  await sharp({
    create: { width, height, channels: 3, background: { r: 180, g: 90, b: 40 } },
  })
    .jpeg()
    .toFile(filePath);
}

test('processProduct writes every planned output at the right dimensions', async () => {
  await withTempDirs(async ({ sourceRoot, outputRoot }) => {
    const slug = 'test-planter';
    const srcDir = path.join(sourceRoot, slug);
    await mkdir(srcDir, { recursive: true });
    await makeSyntheticJpeg(path.join(srcDir, '01-front.jpg'));
    await makeSyntheticJpeg(path.join(srcDir, '02-side.jpg'));

    const written = await processProduct(slug, { sourceRoot, outputRoot });
    assert.equal(written.length, 6);

    const outDir = path.join(outputRoot, slug);
    const expected = planOutputs(planSources(['01-front.jpg', '02-side.jpg']));
    for (const name of expected) {
      assert.ok(written.some((p) => p === path.join(outDir, name)), `missing ${name}`);
    }

    const small = await sharp(path.join(outDir, '01-front-600.webp')).metadata();
    assert.ok(small.width <= 600 && small.height <= 600);

    const large = await sharp(path.join(outDir, '01-front-1200.webp')).metadata();
    assert.ok(large.width <= 1200 && large.height <= 1200);

    const main = await sharp(path.join(outDir, 'main-1200x1500.webp')).metadata();
    assert.equal(main.width, 1200);
    assert.equal(main.height, 1500);

    const og = await sharp(path.join(outDir, 'og-1200x630.webp')).metadata();
    assert.equal(og.width, 1200);
    assert.equal(og.height, 630);
  });
});

test('processProduct throws a clear error when the source folder is missing', async () => {
  await withTempDirs(async ({ sourceRoot, outputRoot }) => {
    await assert.rejects(
      () => processProduct('nonexistent', { sourceRoot, outputRoot }),
      /no source photos/,
    );
  });
});

test('processProduct throws a clear error when the source folder has no matching files', async () => {
  await withTempDirs(async ({ sourceRoot, outputRoot }) => {
    const srcDir = path.join(sourceRoot, 'empty-product');
    await mkdir(srcDir, { recursive: true });
    await assert.rejects(
      () => processProduct('empty-product', { sourceRoot, outputRoot }),
      /no files matching/,
    );
  });
});
