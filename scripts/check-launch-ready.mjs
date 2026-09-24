#!/usr/bin/env node
/**
 * check-launch-ready — refuses to call the storefront launch-ready while it
 * still carries scaffold content.
 *
 * Why this exists: site-engine's CLAUDE.md records the failure this prevents —
 * a client site shipped with a `.example` URL and an ungated production
 * deploy, because nothing mechanically checked for leftovers. Three launch
 * documents in this repo describe what to verify by hand; none of them can
 * fail a build. A checklist a human reads is not a gate.
 *
 * Every finding names the file AND the fix, per the repo convention that a
 * failure a human cannot act on is a failure reported twice.
 *
 * Usage:
 *   node scripts/check-launch-ready.mjs          # human output, exit 1 on any fail
 *   node scripts/check-launch-ready.mjs --json   # machine output
 *
 * This checks CONTENT readiness only. It deliberately does NOT read .env* —
 * keys are the human's alone, and a script that reads them is a script that
 * can leak them. Whether Stripe is wired is proven by a test order, not by a
 * file this can see.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JSON_OUT = process.argv.includes('--json');

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const products = () => {
  const raw = JSON.parse(read('data/products.json'));
  return { raw, list: Array.isArray(raw) ? raw : (raw.products ?? []) };
};

/** A placeholder Stripe price is the difference between a sale and a 500. */
const PLACEHOLDER_PRICE = /^price_(sample|TODO|test)|TODO/i;

/** Scaffold images are inline data: URIs; real photography is a file on disk. */
const isPlaceholderImage = (src) => typeof src === 'string' && src.startsWith('data:');

const checks = [
  {
    name: 'font-weights-loaded',
    why: 'A weight the tokens ask for but the page never loads is faux-rendered by the browser. Nothing errors, nothing looks broken — the letterforms are just quietly wrong, on every heading, forever.',
    run() {
      const vars = read('node_modules/@hirobius/design-system/dist/variables.css');

      /** `var(--x)` -> the value of `--x`, chased through the variable graph. */
      const deref = (value, depth = 0) => {
        const m = /^var\(--([a-zA-Z0-9-]+)\)$/.exec((value ?? '').trim());
        if (!m || depth > 8) return (value ?? '').trim();
        const hit = new RegExp(`--${m[1]}:\\s*([^;]+);`).exec(vars);
        return hit ? deref(hit[1], depth + 1) : '';
      };

      // Weight is only meaningful against the family it renders in. Checking a
      // flat set of weights would demand Satoshi 400 because the MONO style
      // asks for 400 — a different typeface entirely. Pair them at the source.
      const byFamily = new Map();
      const unresolved = [];
      const styles = new Set(
        [...vars.matchAll(/--semantic-typography-([a-z0-9]+)-font-family:/g)].map((m) => m[1]),
      );
      for (const style of styles) {
        const family = deref(
          new RegExp(`--semantic-typography-${style}-font-family:\\s*([^;]+);`).exec(vars)?.[1],
        )
          .split(',')[0]
          .replace(/["']/g, '')
          .trim();
        // deref returns '' for anything it cannot chase, and Number('') is 0 —
        // which is finite, so a guard on isFinite alone would quietly record
        // "this family needs weight 0" and then pass, having checked nothing.
        const rawWeight = deref(
          new RegExp(`--semantic-typography-${style}-font-weight:\\s*([^;]+);`).exec(vars)?.[1],
        );
        if (!family || !/^[1-9][0-9]{2}$/.test(rawWeight)) {
          unresolved.push(`${style} (family "${family || '?'}", weight "${rawWeight}")`);
          continue;
        }
        const weight = Number(rawWeight);
        if (!byFamily.has(family)) byFamily.set(family, { weights: new Set(), styles: [] });
        byFamily.get(family).weights.add(weight);
        byFamily.get(family).styles.push(style);
      }

      if (!byFamily.size) {
        return {
          ok: false,
          detail: 'Parsed no family/weight pairs out of the design system variables — the check cannot see its input.',
          fix: 'Run `pnpm add @hirobius/design-system`, then re-run. A check that reads nothing must fail, never pass.',
        };
      }

      // A style whose family or weight would not resolve is a hole in the very
      // thing being checked. Report it as a failure rather than checking the
      // styles that happened to parse and calling that a pass.
      if (unresolved.length) {
        return {
          ok: false,
          detail: `could not resolve family/weight for: ${unresolved.join(', ')}`,
          fix: 'The design system emitted a typography variable this check cannot follow. Fix it upstream in HDS, or teach deref() the new shape — do not narrow the check.',
        };
      }

      // What index.html actually fetches. Fontshare: f[]=slug@400,500.
      // Google Fonts: family=Name:wght@400;500.
      const html = read('index.html');
      const loaded = new Map();
      const add = (name, weights) => {
        const key = name.toLowerCase().replace(/[-+_]/g, ' ').trim();
        if (!loaded.has(key)) loaded.set(key, new Set());
        for (const w of weights) loaded.get(key).add(Number(w));
      };
      for (const [, slug, list] of html.matchAll(/f\[\]=([a-z0-9-]+)@([0-9,]+)/g)) add(slug, list.split(','));
      for (const [, name, list] of html.matchAll(/family=([A-Za-z0-9+ ]+):wght@([0-9;]+)/g)) add(name, list.split(';'));

      const problems = [];
      const notes = [];
      for (const [family, { weights, styles: used }] of byFamily) {
        const want = [...weights].sort((a, b) => a - b);
        const have = loaded.get(family.toLowerCase().replace(/[-+_]/g, ' ').trim());
        if (!have) {
          problems.push(
            `${family} is not loaded at all — needs ${want.join(', ')} for ${used.sort().join(', ')}`,
          );
          continue;
        }
        const missing = want.filter((w) => !have.has(w));
        const extra = [...have].filter((w) => !weights.has(w)).sort((a, b) => a - b);
        if (missing.length) problems.push(`${family} missing ${missing.join(', ')} (needs ${want.join(', ')})`);
        if (extra.length) notes.push(`${family} loads ${extra.join(', ')} that no token uses — dead bytes`);
      }

      const inventory = [...byFamily]
        .map(([f, { weights }]) => `${f} ${[...weights].sort((a, b) => a - b).join('/')}`)
        .join(' · ');

      return {
        ok: problems.length === 0,
        detail: problems.length
          ? problems.join('\n      ')
          : `${inventory}${notes.length ? `\n      note: ${notes.join('; ')}` : ''}`,
        fix: 'Load the missing family/weight in index.html, or — if a style genuinely should not use that face — change the token upstream in HDS rather than papering over it here.',
      };
    },
  },
  {
    name: 'stripe-price-ids',
    why: 'A placeholder price id means checkout fails at the moment money would change hands.',
    run() {
      const { list } = products();
      const bad = list.filter((p) => PLACEHOLDER_PRICE.test(p.stripePriceId ?? ''));
      return {
        ok: bad.length === 0,
        detail: bad.length
          ? bad.map((p) => `${p.slug} → ${p.stripePriceId}`).join('\n      ')
          : `${list.length} product(s), all with real price ids`,
        fix: 'Create each product in Stripe, then paste its price_… into data/products.json (SETUP.md §3).',
      };
    },
  },
  {
    name: 'real-photography',
    why: 'Inline SVG placeholders ship as the product photo — the one thing a buyer decides on.',
    run() {
      const { list } = products();
      const bad = [];
      for (const p of list) {
        const raw = p.images ?? [];
        if (!raw.length) {
          bad.push(`${p.slug} → no images at all`);
          continue;
        }
        // images[] is {src, alt}. An unrecognised shape FAILS rather than passes:
        // when this file changed shape, the old string check silently returned
        // false for every entry and the gate went green on three placeholder
        // products. A check that cannot read its input must say so.
        const srcs = [];
        for (const img of raw) {
          if (typeof img?.src === 'string') srcs.push(img.src);
          else bad.push(`${p.slug} → unreadable image entry (expected {src, alt}, got ${typeof img})`);
          if (typeof img?.alt !== 'string' || !img.alt.trim())
            bad.push(`${p.slug} → image missing alt text: ${String(img?.src).slice(0, 40)}`);
        }
        const placeholders = srcs.filter(isPlaceholderImage).length;
        const missing = srcs
          .filter((s) => !s.startsWith('data:') && s.startsWith('/'))
          .filter((s) => !existsSync(path.join(ROOT, 'public', s.replace(/^\//, ''))));
        if (placeholders) bad.push(`${p.slug} → ${placeholders} placeholder data: URI(s)`);
        if (missing.length) bad.push(`${p.slug} → referenced but not on disk: ${missing.join(', ')}`);
      }
      return {
        ok: bad.length === 0,
        detail: bad.length ? bad.join('\n      ') : `${list.length} product(s) with real image files`,
        fix: 'Shoot the work and save under public/products/<slug>/ (SETUP.md §6), then reference those paths.',
      };
    },
  },
  {
    name: 'sample-catalog-marker',
    why: 'The catalog still declares itself a sample, which means nobody has replaced it.',
    run() {
      const { raw } = products();
      const marker = typeof raw._comment === 'string' && /starter|sample/i.test(raw._comment);
      return {
        ok: !marker,
        detail: marker ? `data/products.json _comment: "${raw._comment.slice(0, 80)}…"` : 'no sample marker',
        fix: 'Replace the starter catalog with real work and delete the _comment key.',
      };
    },
  },
  {
    name: 'no-stale-monorepo-paths',
    why: 'This repo was extracted; apps/concrete no longer exists. Following a doc that says otherwise misconfigures the Vercel root directory and the import fails.',
    run() {
      const docs = ['README.md', 'SETUP.md']
        .concat(
          existsSync(path.join(ROOT, 'docs'))
            ? readdirSync(path.join(ROOT, 'docs'))
                .filter((f) => f.endsWith('.md'))
                .map((f) => `docs/${f}`)
            : [],
        )
        .filter((f) => existsSync(path.join(ROOT, f)));
      const hits = [];
      for (const f of docs) {
        read(f)
          .split('\n')
          .forEach((line, i) => {
            if (line.includes('apps/concrete')) hits.push(`${f}:${i + 1}`);
          });
      }
      return {
        ok: hits.length === 0,
        detail: hits.length ? hits.join(', ') : `${docs.length} doc(s) clean`,
        fix: 'Delete the apps/concrete prefix — the repo root is the app. Vercel root directory is "." (blank).',
      };
    },
  },
  {
    name: 'documented-env-vars',
    why: 'A variable the code reads but no document names is one nobody sets, and it fails in production rather than locally.',
    run() {
      const dirs = ['api', 'src'];
      const found = new Set();
      const walk = (dir) => {
        const abs = path.join(ROOT, dir);
        if (!existsSync(abs)) return;
        for (const e of readdirSync(abs)) {
          const p = path.join(abs, e);
          if (statSync(p).isDirectory()) walk(path.join(dir, e));
          else if (/\.(ts|tsx|mjs|js)$/.test(e)) {
            for (const m of readFileSync(p, 'utf8').matchAll(/process\.env\.([A-Z0-9_]+)/g)) found.add(m[1]);
          }
        }
      };
      dirs.forEach(walk);
      const docText = ['SETUP.md', 'README.md']
        .filter((f) => existsSync(path.join(ROOT, f)))
        .map(read)
        .join('\n');
      const undocumented = [...found].filter((v) => !docText.includes(v)).sort();
      return {
        ok: undocumented.length === 0,
        detail: undocumented.length
          ? `read by code, named in no doc: ${undocumented.join(', ')}`
          : `${found.size} env var(s), all documented`,
        fix: 'Document each variable in SETUP.md §3/§4, including whether it is required or has a fallback.',
      };
    },
  },
  {
    name: 'no-pinned-node-runtime',
    why: 'Pinning @vercel/node in vercel.json fixes the function to one Node major. Vercel moves its default forward, the pin stops matching, and the deploy fails on a build that otherwise succeeded — which is exactly how the first deploy of this repo died.',
    run() {
      const cfg = JSON.parse(read('vercel.json'));
      const pinned = Object.entries(cfg.functions ?? {})
        .filter(([, v]) => typeof v?.runtime === 'string' && /^@vercel\/node/.test(v.runtime))
        .map(([k, v]) => `${k} → ${v.runtime}`);
      const pkg = JSON.parse(read('package.json'));
      const engine = pkg.engines?.node;
      const problems = [...pinned];
      if (!engine) problems.push('package.json has no engines.node — the Node version lives only in a dashboard setting');
      return {
        ok: problems.length === 0,
        detail: problems.length ? problems.join('\n      ') : `no runtime pin; engines.node = ${engine}`,
        fix: 'Delete the runtime key (it is for custom runtimes like vercel-php, not Node) and declare engines.node in package.json — that overrides the project setting.',
      };
    },
  },
  {
    name: 'no-placeholder-strings',
    why: 'The exact class of leak that shipped on a client site before: a scaffold string reaching production.',
    run() {
      const patterns = [
        [/example\.com/i, 'example.com'],
        [/555-01\d\d/, '555-01xx phone'],
        [/lorem ipsum/i, 'lorem ipsum'],
        [/your-domain|yourdomain/i, 'your-domain'],
      ];
      const hits = [];
      const scan = (dir) => {
        const abs = path.join(ROOT, dir);
        if (!existsSync(abs)) return;
        for (const e of readdirSync(abs)) {
          const p = path.join(abs, e);
          if (statSync(p).isDirectory()) scan(path.join(dir, e));
          else if (/\.(ts|tsx|json|html)$/.test(e)) {
            const text = readFileSync(p, 'utf8');
            for (const [re, label] of patterns) if (re.test(text)) hits.push(`${dir}/${e} → ${label}`);
          }
        }
      };
      ['src', 'data'].forEach(scan);
      if (existsSync(path.join(ROOT, 'index.html')) && /example\.com/i.test(read('index.html')))
        hits.push('index.html → example.com');
      return {
        ok: hits.length === 0,
        detail: hits.length ? hits.join('\n      ') : 'no placeholder strings in shipped content',
        fix: 'Replace with the real value, or delete the line if it was scaffold.',
      };
    },
  },
];

const results = checks.map((c) => {
  try {
    return { name: c.name, why: c.why, fix: c.fix, ...c.run() };
  } catch (err) {
    return { name: c.name, why: c.why, ok: false, detail: `check threw: ${err.message}`, fix: 'Fix the check or the data it reads.' };
  }
});

const failed = results.filter((r) => !r.ok);

if (JSON_OUT) {
  console.log(JSON.stringify({ launchReady: failed.length === 0, results }, null, 2));
} else {
  console.log('\ncheck-launch-ready — Hirobius Studio\n');
  for (const r of results) {
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}`);
    console.log(`      ${r.detail}`);
    if (!r.ok) {
      console.log(`      why: ${r.why}`);
      console.log(`      fix: ${r.fix}`);
    }
    console.log('');
  }
  console.log(
    failed.length === 0
      ? '✓ content is launch-ready. Keys and a live test order are still yours to verify — see docs/GO-LIVE-RUNBOOK.md.\n'
      : `✗ ${failed.length} of ${results.length} check(s) block launch.\n`,
  );
}

process.exit(failed.length === 0 ? 0 : 1);
