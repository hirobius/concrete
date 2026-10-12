import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { extractImageBytes, isHeic, intakePhoto } from './intake-photo.mjs';

const jpeg = (w = 64, h = 48, meta) => {
  let img = sharp({ create: { width: w, height: h, channels: 3, background: '#7a7670' } });
  if (meta) img = img.withMetadata(meta);
  return img.jpeg().toBuffer();
};

async function withRoot(fn) {
  const root = await mkdtemp(path.join(tmpdir(), 'intake-'));
  try {
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('extractImageBytes passes raw image bytes through untouched', async () => {
  const img = await jpeg();
  assert.ok(extractImageBytes(img).equals(img));
});

test('extractImageBytes decodes a Drive download result (JSON with base64 content)', async () => {
  const img = await jpeg();
  const result = JSON.stringify({ content: img.toString('base64'), id: 'abc', mimeType: 'image/jpeg' });
  assert.ok(extractImageBytes(Buffer.from(result)).equals(img));
});

test('extractImageBytes finds the payload inside a wrapped, saved tool-result file', async () => {
  const img = await jpeg();
  const saved = [
    '<tool-result untrusted="true">',
    'Saved because it exceeded the inline limit.',
    JSON.stringify({ content: img.toString('base64'), title: '01-front.jpg' }),
    '</tool-result>',
  ].join('\n');
  assert.ok(extractImageBytes(Buffer.from(saved)).equals(img));
});

test('extractImageBytes decodes bare base64', async () => {
  const img = await jpeg();
  assert.ok(extractImageBytes(Buffer.from(img.toString('base64'))).equals(img));
});

test('extractImageBytes rejects non-image input with a fix', () => {
  assert.throws(() => extractImageBytes(Buffer.from('{"content":"aGVsbG8="}')), /fix:/);
  assert.throws(() => extractImageBytes(Buffer.from('not an image at all')), /not an image/);
});

test('isHeic recognises HEIC/HEIF brands but leaves AVIF (sharp-readable) alone', () => {
  const box = (brand) => Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from(`ftyp${brand}`, 'latin1'), Buffer.alloc(12)]);
  assert.equal(isHeic(box('heic')), true);
  assert.equal(isHeic(box('mif1')), true);
  assert.equal(isHeic(box('avif')), false);
  assert.equal(isHeic(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), false);
});

test('intakePhoto writes photos-src/<slug>/<NN-angle>.jpg from a Drive payload', async () => {
  await withRoot(async (sourceRoot) => {
    const img = await jpeg(80, 100);
    const payload = Buffer.from(JSON.stringify({ content: img.toString('base64') }));
    const r = await intakePhoto({ input: payload, slug: 'river-stone', name: '01-front', sourceRoot });
    assert.equal(r.file, path.join(sourceRoot, 'river-stone', '01-front.jpg'));
    const meta = await sharp(r.file).metadata();
    assert.equal(meta.format, 'jpeg');
    assert.equal(meta.width, 80);
  });
});

test('intakePhoto bakes EXIF rotation into the pixels', async () => {
  await withRoot(async (sourceRoot) => {
    const sideways = await jpeg(160, 120, { orientation: 6 }); // stored landscape, displayed portrait
    const r = await intakePhoto({ input: sideways, slug: 'tilted', name: '01-front', sourceRoot });
    assert.ok(r.height > r.width, `expected portrait, got ${r.width}×${r.height}`);
    const meta = await sharp(r.file).metadata();
    assert.ok(!meta.orientation || meta.orientation === 1, 'no rotation tag left to misread');
  });
});

test('intakePhoto rejects a bad slug or name before writing anything', async () => {
  await withRoot(async (sourceRoot) => {
    const img = await jpeg();
    await assert.rejects(intakePhoto({ input: img, slug: 'Bad Slug', name: '01-front', sourceRoot }), /kebab-case/);
    await assert.rejects(intakePhoto({ input: img, slug: 'ok-slug', name: 'front', sourceRoot }), /NN-angle/);
  });
});
