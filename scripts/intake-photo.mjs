#!/usr/bin/env node
/**
 * intake-photo — turn one raw photo (as it arrives from Drive or a phone) into
 * a pipeline-ready source file: photos-src/<slug>/<NN-angle>.jpg.
 *
 * Why this exists: the publish flow (docs/PUBLISHING.md) pulls Adrian's
 * originals out of Google Drive. Three things about those files would
 * otherwise break or degrade the photo pipeline (scripts/process-product-photos.mjs):
 *
 *   1. They arrive as base64 inside a Drive download result — sometimes inline,
 *      sometimes (for full-size photos) saved by the agent harness to a text
 *      file with a wrapper around the JSON. This finds the bytes either way.
 *   2. iPhones shoot HEIC by default, and the prebuilt `sharp` reads AVIF but
 *      not HEIC. HEIC is converted to JPEG here (heic-convert, pure JS).
 *   3. Phones store rotation as an EXIF tag. It's baked into the pixels here,
 *      so nothing downstream can publish a piece sideways.
 *
 * The output is always a high-quality JPEG. Metadata (including GPS location)
 * is not carried over.
 *
 * Usage:
 *   pnpm photos:intake -- <input> <slug> <NN-angle>
 *     <input>    an image file (jpg/png/webp/heic), a saved Drive download
 *                result (any text containing "content":"<base64>"), or a
 *                raw base64 file
 *     <slug>     the product's slug, e.g. river-stone-planter
 *     <NN-angle> e.g. 01-front (lowest number = hero shot)
 */

import { readFileSync, existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';
import heicConvert from 'heic-convert';
import { SOURCE_ROOT, parseSourceFilename } from './process-product-photos.mjs';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** HEIF-family brands that need conversion (AVIF is readable by sharp as-is). */
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);

function looksLikeImage(buf) {
  if (buf.length < 12) return false;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true; // JPEG
  if (buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return true; // PNG
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return true;
  if (buf.toString('latin1', 4, 8) === 'ftyp') return true; // HEIF family (HEIC/AVIF)
  return false;
}

/** True for HEIC/HEIF containers that sharp can't read (i.e. not AVIF). */
export function isHeic(buf) {
  if (buf.length < 12 || buf.toString('latin1', 4, 8) !== 'ftyp') return false;
  return HEIC_BRANDS.has(buf.toString('latin1', 8, 12));
}

/**
 * Return the raw image bytes from whatever `input` holds: the image itself,
 * a Drive download result (JSON with a base64 `content` field, possibly
 * wrapped in other text), or bare base64. Throws with a fix if none apply.
 */
export function extractImageBytes(input) {
  if (looksLikeImage(input)) return input;

  const text = input.toString('utf8');
  const field = /"content"\s*:\s*"([A-Za-z0-9+/=_-]+)"/.exec(text);
  const candidates = [];
  if (field) candidates.push(field[1]);
  if (/^[A-Za-z0-9+/=\s]+$/.test(text.trim())) candidates.push(text.replace(/\s+/g, ''));

  for (const b64 of candidates) {
    const bytes = Buffer.from(b64, 'base64');
    if (looksLikeImage(bytes)) return bytes;
  }
  throw new Error(
    'input is not an image, a Drive download result, or base64 image data.\n' +
      '  fix: pass the saved download file the Drive tool reported, or the image file itself.',
  );
}

/** Decode HEIC if needed, bake EXIF rotation into the pixels, emit JPEG. */
export async function normalizeToJpeg(bytes) {
  let decodable = bytes;
  if (isHeic(bytes)) {
    decodable = Buffer.from(await heicConvert({ buffer: bytes, format: 'JPEG', quality: 0.95 }));
  }
  return sharp(decodable).rotate().jpeg({ quality: 92, mozjpeg: true }).toBuffer();
}

/** Full intake: write photos-src/<slug>/<name>.jpg. Returns { file, width, height }. */
export async function intakePhoto({ input, slug, name, sourceRoot = SOURCE_ROOT }) {
  if (!SLUG_RE.test(slug)) throw new Error(`slug "${slug}" must be kebab-case, e.g. river-stone-planter`);
  const filename = `${name}.jpg`;
  if (!parseSourceFilename(filename)) {
    throw new Error(`name "${name}" must look like NN-angle, e.g. 01-front (see docs/PRODUCT-IMAGES.md)`);
  }

  const jpeg = await normalizeToJpeg(extractImageBytes(input));
  const dir = path.join(sourceRoot, slug);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, filename);
  await sharp(jpeg).toFile(file);
  const { width, height } = await sharp(jpeg).metadata();
  return { file, width, height };
}

async function main() {
  const [inputPath, slug, name] = process.argv.slice(2).filter((a) => a !== '--');
  if (!inputPath || !slug || !name) {
    console.error('usage: pnpm photos:intake -- <input> <slug> <NN-angle>');
    process.exit(1);
  }
  if (!existsSync(inputPath)) {
    console.error(`intake-photo: ${inputPath} does not exist`);
    process.exit(1);
  }
  try {
    const { file, width, height } = await intakePhoto({ input: readFileSync(inputPath), slug, name });
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    console.log(`intake-photo: wrote ${path.relative(root, file)} (${width}×${height})`);
  } catch (e) {
    console.error(`intake-photo: ${e.message}`);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
