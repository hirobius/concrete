import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanColorLiterals } from './check-token-discipline.mjs';

test('flags a hex color literal', () => {
  const f = scanColorLiterals('.x { color: #8B6F47; }');
  assert.equal(f.length, 1);
  assert.equal(f[0].match, '#8B6F47');
});

test('flags 3-, 4- and 8-digit hex', () => {
  assert.equal(scanColorLiterals('color:#fff').length, 1);
  assert.equal(scanColorLiterals('color:#ffff').length, 1);
  assert.equal(scanColorLiterals('color:#ffffffff').length, 1);
});

test('flags rgb/rgba/hsl/oklch color functions', () => {
  assert.equal(scanColorLiterals('background: rgba(0,0,0,.4)').length, 1);
  assert.equal(scanColorLiterals('color: hsl(20 30% 40%)').length, 1);
  assert.equal(scanColorLiterals('color: oklch(0.6 0.1 40)').length, 1);
});

test('passes clean token-driven source', () => {
  const src = `
    .btn { background: var(--semantic-surface-accent); color: var(--semantic-content-inverse); }
    export const x = <div className="bg-accent text-inverse" />;
  `;
  assert.deepEqual(scanColorLiterals(src), []);
});

test('does not flag issue refs like hds#283 in comments', () => {
  const src = '/* Upstream: hds#283 (type ramp) decides fluid sizes. */\n.x { width: 10px }';
  assert.deepEqual(scanColorLiterals(src), []);
});

test('does not flag a bare issue ref outside a comment', () => {
  // `#283` preceded by a word char is an issue ref, not a color.
  assert.deepEqual(scanColorLiterals('see hds#283 for context'), []);
});

test('does not flag URLs (:// is not a line comment, no hex inside)', () => {
  assert.deepEqual(scanColorLiterals('const u = "https://example.com/path";'), []);
});

test('ignores a hex that only appears inside a line comment', () => {
  assert.deepEqual(scanColorLiterals('const x = 1; // was #ff0000 before tokenizing'), []);
});

test('reports accurate line numbers across block comments', () => {
  const src = ['/* multi', 'line', 'comment */', '.x { color: #abc; }'].join('\n');
  const f = scanColorLiterals(src);
  assert.equal(f.length, 1);
  assert.equal(f[0].line, 4);
});
