#!/usr/bin/env node
// Raw product photos -> card-ready derivatives.
// Convention + usage: docs/PRODUCT-IMAGES.md
//
//   pnpm photos <slug>
//   pnpm photos --all
//
// Pure logic (parsing, planning) is exported and unit-tested without
// touching the filesystem or sharp; `processProduct`/`main` do the actual
// image I/O and are exercised in the test file against a synthetic image.

import { readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

export const SOURCE_ROOT = path.join(REPO_ROOT, 'photos-src');
export const OUTPUT_ROOT = path.join(REPO_ROOT, 'public', 'products');

const SOURCE_NAME_RE = /^(\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.(jpe?g|png|webp|tiff?)$/i;

/**
 * Parse a source filename per the `NN-<angle>.<ext>` convention.
 * Returns null for anything that doesn't match (e.g. dotfiles, READMEs).
 */
export function parseSourceFilename(filename) {
  const m = SOURCE_NAME_RE.exec(filename);
  if (!m) return null;
  return { seq: m[1], angle: m[2].toLowerCase(), ext: m[3].toLowerCase(), filename };
}

/**
 * Sort parsed source entries by sequence number, and identify the hero
 * (lowest NN) — the one that also feeds `main-*` and `og-*`.
 */
export function planSources(filenames) {
  const parsed = filenames.map(parseSourceFilename).filter(Boolean);
  parsed.sort((a, b) => a.seq.localeCompare(b.seq));
  return parsed;
}

/**
 * The full list of output filenames a given set of parsed sources produces,
 * for a slug. Pure — no filesystem access.
 */
export function planOutputs(parsedSources) {
  const outputs = [];
  for (const src of parsedSources) {
    const base = `${src.seq}-${src.angle}`;
    outputs.push(`${base}-600.webp`, `${base}-1200.webp`);
  }
  if (parsedSources.length > 0) {
    outputs.push('main-1200x1500.webp', 'og-1200x630.webp');
  }
  return outputs;
}

async function resizeToWebp(inputPath, outputPath, resizeOpts) {
  await sharp(inputPath).resize(resizeOpts).webp({ quality: 82 }).toFile(outputPath);
}

/**
 * Process one product's source photos into public/products/<slug>/.
 * Returns the list of output file paths written.
 */
export async function processProduct(slug, { sourceRoot = SOURCE_ROOT, outputRoot = OUTPUT_ROOT } = {}) {
  const srcDir = path.join(sourceRoot, slug);
  if (!existsSync(srcDir)) {
    throw new Error(`no source photos: ${srcDir} does not exist (see docs/PRODUCT-IMAGES.md)`);
  }

  const entries = await readdir(srcDir);
  const sources = planSources(entries);
  if (sources.length === 0) {
    throw new Error(`${srcDir} has no files matching NN-<angle>.<ext> (see docs/PRODUCT-IMAGES.md)`);
  }

  const outDir = path.join(outputRoot, slug);
  await mkdir(outDir, { recursive: true });

  const written = [];
  for (const src of sources) {
    const inputPath = path.join(srcDir, src.filename);
    const base = `${src.seq}-${src.angle}`;

    const small = path.join(outDir, `${base}-600.webp`);
    await resizeToWebp(inputPath, small, { width: 600, height: 600, fit: 'inside', withoutEnlargement: true });
    written.push(small);

    const large = path.join(outDir, `${base}-1200.webp`);
    await resizeToWebp(inputPath, large, { width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true });
    written.push(large);
  }

  const hero = sources[0];
  const heroInput = path.join(srcDir, hero.filename);

  const main = path.join(outDir, 'main-1200x1500.webp');
  await resizeToWebp(heroInput, main, { width: 1200, height: 1500, fit: 'cover', position: 'attention' });
  written.push(main);

  const og = path.join(outDir, 'og-1200x630.webp');
  await resizeToWebp(heroInput, og, { width: 1200, height: 630, fit: 'cover', position: 'attention' });
  written.push(og);

  return written;
}

async function listSlugs() {
  if (!existsSync(SOURCE_ROOT)) return [];
  const entries = await readdir(SOURCE_ROOT, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || (args[0] !== '--all' && args[0].startsWith('-'))) {
    console.error('Usage: pnpm photos <slug> | pnpm photos --all');
    process.exitCode = 1;
    return;
  }

  const slugs = args[0] === '--all' ? await listSlugs() : [args[0]];
  if (slugs.length === 0) {
    console.error(`No product folders found under ${path.relative(REPO_ROOT, SOURCE_ROOT)}/ (see docs/PRODUCT-IMAGES.md)`);
    process.exitCode = 1;
    return;
  }

  let failed = false;
  for (const slug of slugs) {
    try {
      const written = await processProduct(slug);
      console.log(`${slug}: wrote ${written.length} file(s) to public/products/${slug}/`);
    } catch (err) {
      failed = true;
      console.error(`${slug}: ${err.message}`);
    }
  }
  if (failed) process.exitCode = 1;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main();
}
