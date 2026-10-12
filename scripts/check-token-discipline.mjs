#!/usr/bin/env node
/**
 * check-token-discipline — fails if any app source carries a raw color value
 * instead of deriving it from an HDS token.
 *
 * Why this exists (Adrian, 2026-10-12): this storefront deliberately does NOT
 * adopt HDS React components — HDS is meant to be extended, so hand-rolled
 * components are the sanctioned pattern here. The one hard rule that makes
 * that safe is: *anything rendered must come from HDS tokens under the hood.*
 * The HDS adoption audit found the code currently honours that (zero raw
 * colors in component code). This gate turns "currently true" into "enforced",
 * so a future edit can't quietly reintroduce an off-token color.
 *
 * What counts as a violation: a hex color (#rgb/#rgba/#rrggbb/#rrggbbaa) or a
 * color function (rgb/rgba/hsl/hsla/hwb/lab/lch/oklch/oklab/color) literal in
 * src/. Everything visual should instead be a `var(--semantic-*)` token or a
 * Tailwind class bound to one (tailwind.config.ts binds them all).
 *
 * What is allowed: the auto-generated brand-delta layer
 * (src/styles/tenant-overlay.generated.css) — that IS the designated home for
 * brand color values, written by scripts/generate-tenant-overlay.mjs from
 * tenant/tokens.json and verified separately by `pnpm tokens:check`.
 *
 * Comments are stripped before scanning (preserving line numbers), so issue
 * refs like `hds#283` and URLs like `https://…` never read as colors.
 *
 * Every finding names the file:line AND the fix, per the repo convention that
 * a failure a human cannot act on is a failure reported twice.
 *
 * Usage:
 *   node scripts/check-token-discipline.mjs          # human output, exit 1 on any finding
 *   node scripts/check-token-discipline.mjs --json   # machine output
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const JSON_OUT = process.argv.includes('--json');

const EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.css']);

/** Paths (repo-relative) allowed to carry raw color values. */
const ALLOW = new Set([
  'src/styles/tenant-overlay.generated.css', // generated brand delta; verified by tokens:check
]);

/** Blank out comment bodies while preserving newlines + columns. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')) // block (css + js)
    .replace(/(^|[^:])(\/\/[^\n]*)/g, (_, pre, com) => pre + com.replace(/./g, ' ')); // line, keep ://
}

// `#` not preceded by a word char or another `#` (excludes hds#283), then 3/4/6/8 hex digits.
const HEX = /(?<![\w#])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/g;
const FUNC = /\b(?:rgba?|hsla?|hwb|lab|lch|oklch|oklab|color)\s*\(/g;

/**
 * Pure scanner. Returns [{ line, match }] of raw color literals in `source`.
 * Exported for the test suite.
 */
export function scanColorLiterals(source) {
  const clean = stripComments(source);
  const findings = [];
  clean.split('\n').forEach((line, i) => {
    for (const re of [HEX, FUNC]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line)) !== null) {
        findings.push({ line: i + 1, match: m[0].trim() });
      }
    }
  });
  return findings;
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (EXTS.has(path.extname(name))) out.push(full);
  }
  return out;
}

function main() {
  const violations = [];
  for (const file of walk(SRC)) {
    const rel = path.relative(ROOT, file);
    if (ALLOW.has(rel)) continue;
    for (const f of scanColorLiterals(readFileSync(file, 'utf8'))) {
      violations.push({ file: rel, line: f.line, match: f.match });
    }
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ ok: violations.length === 0, violations }, null, 2));
    process.exit(violations.length ? 1 : 0);
  }

  if (violations.length === 0) {
    console.log('check-token-discipline: OK — no raw colors in src; everything derives from HDS tokens.');
    process.exit(0);
  }

  console.error(`check-token-discipline: ${violations.length} raw color literal(s) in src/\n`);
  for (const v of violations) console.error(`  ${v.file}:${v.line}  →  ${v.match}`);
  console.error(
    '\n  why: a raw color is a copy of a system decision nothing re-checks — it drifts from HDS.' +
      '\n  fix: use an HDS token — a `var(--semantic-*)` or a Tailwind class bound to one (tailwind.config.ts).' +
      '\n       brand values belong in tenant/tokens.json → run `pnpm tokens:overlay` to regenerate the overlay.',
  );
  process.exit(1);
}

// Run only when invoked directly, so the test can import scanColorLiterals.
if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
