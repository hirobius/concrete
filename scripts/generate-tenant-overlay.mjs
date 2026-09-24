#!/usr/bin/env node
/**
 * generate-tenant-overlay — emit ONLY the tokens this tenant overrides.
 *
 * Hirobius Studio is a Hirobius Design System tenant. Everything visual that is
 * not brand-specific — the type ramp, spacing, radii, elevation, the whole
 * semantic colour model — belongs to HDS, and this repo should receive it
 * rather than restate it.
 *
 * WHAT THIS REPLACES, AND WHY
 *
 * `src/styles/tokens.generated.css` used to carry 21 hand-written custom
 * properties under a header reading "AUTO-GENERATED … Regenerate if the overlay
 * or base tokens change". No generator existed. The file was written once, by
 * hand, wearing a label that asserted a provenance it did not have — so
 * "regenerate" was an instruction nobody could follow and nothing could check.
 *
 * It also only covered colour. Every other family was restated as a literal in
 * `tailwind.config.ts`, and several had already drifted from HDS: headings at
 * weight 500 where HDS says 700, eyebrow tracking at 0.08em where HDS says
 * 0.06em, and Clash Display as the display face after HDS replaced it with
 * Satoshi in hds#48. The config's own comment claimed it was "bound to the
 * canonical HDS tokens" while forbidding only hardcoded *hex*.
 *
 * THE FIX IS MOSTLY DELETION
 *
 * `@hirobius/design-system` publishes `dist/variables.css` — 508 lines, every
 * semantic token fully resolved, `:root` for light and `[data-theme="dark"]`
 * for dark. `globals.css` imports it. That is the base, and it can no longer
 * drift, because nothing in this repo restates it.
 *
 * This script emits only the delta: the handful of paths `tenant/tokens.json`
 * actually overrides. Today that is eight accent colours. Two files instead of
 * one, and the second one is small enough to read.
 *
 * Usage:
 *   node scripts/generate-tenant-overlay.mjs           write the file
 *   node scripts/generate-tenant-overlay.mjs --check   fail if it is stale
 *
 * The --check mode is the point. A generated file committed to a repo with no
 * gate is the situation this script was written to end.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG = path.join(ROOT, 'node_modules', '@hirobius', 'design-system');
const OVERLAY_SRC = path.join(ROOT, 'tenant', 'tokens.json');
const OUT = path.join(ROOT, 'src', 'styles', 'tenant-overlay.generated.css');

const check = process.argv.includes('--check');

/** Read a required input, or die naming the file AND the fix. */
function must(file, fix) {
  if (!fs.existsSync(file)) {
    console.error(`generate-tenant-overlay: missing ${path.relative(ROOT, file)}`);
    console.error(`  fix: ${fix}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const base = must(
  path.join(PKG, 'hirobius.tokens.json'),
  'pnpm add @hirobius/design-system  — the published package ships the token source',
);
const overlay = must(OVERLAY_SRC, 'restore tenant/tokens.json from git; it is the brand delta and cannot be derived');

const hdsVersion = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8')).version;

/** `{primitive.color.stone.600}` → the value it points at. Chases chains. */
function resolve(value, depth = 0) {
  if (typeof value !== 'string') return value;
  const m = /^\{([^}]+)\}$/.exec(value.trim());
  if (!m) return value;
  if (depth > 10) throw new Error(`token reference loop at ${value}`);
  let node = base;
  for (const seg of m[1].split('.')) {
    node = node?.[seg];
    // A dangling reference must fail the build. The old file's whole problem
    // was looking authoritative while being unverifiable — a silent `undefined`
    // reaching the CSS would be the same bug with a new coat of paint.
    if (node === undefined) throw new Error(`unresolved token reference {${m[1]}} (stopped at "${seg}")`);
  }
  return resolve(node.$value ?? node, depth + 1);
}

/** `semantic.color.surface.accentSubtle` → `--semantic-color-surface-accentSubtle`. Casing is preserved: HDS emits camelCase leaves. */
const varName = (tokenPath) => `--${tokenPath.join('-')}`;

/** Walk the overlay, collecting every leaf that carries a $value. */
function collect(node, trail = [], out = []) {
  if (!node || typeof node !== 'object') return out;
  if ('$value' in node) {
    const modes = node.$extensions?.['com.figma.variables']?.modes;
    out.push({
      name: varName(trail),
      light: resolve(modes?.Light ?? node.$value),
      dark: resolve(modes?.Dark ?? modes?.Light ?? node.$value),
      note: node.$description ?? '',
    });
    return out;
  }
  for (const [k, v] of Object.entries(node)) {
    if (k.startsWith('$')) continue;
    collect(v, [...trail, k], out);
  }
  return out;
}

const tokens = collect(overlay).sort((a, b) => a.name.localeCompare(b.name));

if (!tokens.length) {
  console.error('generate-tenant-overlay: tenant/tokens.json overrides nothing.');
  console.error('  fix: an empty overlay means this tenant is visually identical to base HDS —');
  console.error('       either add the brand overrides, or delete the overlay and the import in globals.css.');
  process.exit(1);
}

// A placeholder that reaches production is a brand nobody chose. Surfaced, not
// enforced: shipping placeholders during a build-out is a legitimate choice,
// silently forgetting them is not. check-launch-ready.mjs is where it blocks.
const placeholders = tokens.filter((t) => /PLACEHOLDER/i.test(t.note));

const body = [
  '/* AUTO-GENERATED by scripts/generate-tenant-overlay.mjs — do not edit by hand.',
  ` * Regenerate: pnpm tokens:overlay     Verify: pnpm tokens:check`,
  ' *',
  ` * Base: @hirobius/design-system@${hdsVersion} (dist/variables.css, imported first in globals.css).`,
  ' * Delta: tenant/tokens.json — the Concrete Creations brand overrides, and nothing else.',
  ' *',
  ' * Everything NOT listed below — type ramp, spacing, radii, elevation, the rest of',
  ' * the colour model — comes from HDS and is deliberately absent here. If you find',
  ' * yourself wanting to add a value to this file, the question is whether it is a',
  ' * brand decision (it belongs in tenant/tokens.json) or a system decision (it',
  ' * belongs in HDS, upstream).',
  ' */',
  '',
  ':root {',
  ...tokens.map((t) => `  ${t.name}: ${t.light};${t.note ? ` /* ${t.note.replace(/\s+/g, ' ').slice(0, 110)} */` : ''}`),
  '}',
  '',
  '[data-theme="dark"] {',
  ...tokens.map((t) => `  ${t.name}: ${t.dark};`),
  '}',
  '',
].join('\n');

if (check) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
  if (current === body) {
    console.log(`✓ tenant overlay in sync — ${tokens.length} token(s) against @hirobius/design-system@${hdsVersion}`);
    if (placeholders.length) {
      console.log(`  ${placeholders.length} still marked PLACEHOLDER (tracked by check:launch, not by this gate)`);
    }
    process.exit(0);
  }
  console.error(`✗ ${path.relative(ROOT, OUT)} is ${current === null ? 'missing' : 'stale'}.`);
  console.error(`  fix: pnpm tokens:overlay  (then commit the result)`);
  if (current !== null) {
    console.error(`  cause: tenant/tokens.json changed, or @hirobius/design-system moved to ${hdsVersion}`);
  }
  process.exit(1);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, body);
console.log(`generate-tenant-overlay: wrote ${tokens.length} token(s) to ${path.relative(ROOT, OUT)}`);
console.log(`  base @hirobius/design-system@${hdsVersion}`);
if (placeholders.length) console.log(`  ${placeholders.length} value(s) still marked PLACEHOLDER`);
