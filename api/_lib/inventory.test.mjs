import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RELEASE_SCRIPT,
  RESERVED_FLAG,
  RESERVE_SCRIPT,
  createMemoryStore,
  createStoreFromEnv,
  getInventory,
  parseCartSlugs,
  processStripeEvent,
  releaseCart,
  reserveCart,
} from './inventory.mjs';

const line = (slug, quantity, seed) => ({ slug, quantity, seed });

test('two concurrent reserves for the last unit: exactly one succeeds', async () => {
  const store = createMemoryStore();
  const results = await Promise.all([store.reserve('a', 1, 1), store.reserve('a', 1, 1)]);
  assert.deepEqual(results.filter(Boolean).length, 1);
  assert.equal((await store.getAll({ a: 1 })).a, 0);
});

test('concurrent carts for the last unit: one wins, loser holds nothing', async () => {
  const store = createMemoryStore();
  const cart = [line('a', 1, 1), line('b', 1, 5)];
  const [x, y] = await Promise.all([reserveCart(store, cart), reserveCart(store, cart)]);
  assert.equal([x, y].filter((r) => r.ok).length, 1);
  assert.deepEqual(await store.getAll({ a: 1, b: 5 }), { a: 0, b: 4 });
});

test('reserve failure releases earlier lines of the same cart', async () => {
  const store = createMemoryStore();
  const result = await reserveCart(store, [line('a', 2, 3), line('b', 1, 5), line('c', 2, 1)]);
  assert.deepEqual(result, { ok: false, slug: 'c' });
  assert.deepEqual(await store.getAll({ a: 3, b: 5, c: 1 }), { a: 3, b: 5, c: 1 });
});

test('a store error mid-cart releases earlier lines and rethrows', async () => {
  const store = createMemoryStore();
  const real = store.reserve;
  store.reserve = async (slug, ...rest) => {
    if (slug === 'b') throw new Error('redis down');
    return real(slug, ...rest);
  };
  await assert.rejects(reserveCart(store, [line('a', 1, 2), line('b', 1, 2)]), /redis down/);
  assert.equal((await store.getAll({ a: 2 })).a, 2);
});

test('an expired session releases its stock, once', async () => {
  const store = createMemoryStore();
  await reserveCart(store, [line('a', 2, 3), line('b', 1, 1)]);
  const event = {
    id: 'evt_exp',
    type: 'checkout.session.expired',
    data: { object: { metadata: { cart_slugs: 'a:2,b:1', [RESERVED_FLAG]: '1' } } },
  };
  assert.equal(await processStripeEvent(store, event, async () => {}), 'handled');
  assert.deepEqual(await store.getAll({ a: 3, b: 1 }), { a: 3, b: 1 });
  // Stripe redelivers: no double release.
  assert.equal(await processStripeEvent(store, event, async () => {}), 'duplicate');
  assert.deepEqual(await store.getAll({ a: 3, b: 1 }), { a: 3, b: 1 });
});

test('an expired session that never reserved (pre-store / fallback) releases nothing', async () => {
  const store = createMemoryStore({ a: 1 });
  const event = {
    id: 'evt_old',
    type: 'checkout.session.expired',
    data: { object: { metadata: { cart_slugs: 'a:1' } } },
  };
  assert.equal(await processStripeEvent(store, event, async () => {}), 'ignored');
  assert.equal((await store.getAll({ a: 1 })).a, 1);
});

test('replaying a completed event is a no-op (Discord posts once, stock untouched)', async () => {
  const store = createMemoryStore();
  await reserveCart(store, [line('a', 1, 2)]);
  const event = {
    id: 'evt_done',
    type: 'checkout.session.completed',
    data: { object: { metadata: { cart_slugs: 'a:1', [RESERVED_FLAG]: '1' } } },
  };
  let posts = 0;
  const notify = async () => void posts++;
  assert.equal(await processStripeEvent(store, event, notify), 'handled');
  assert.equal(await processStripeEvent(store, event, notify), 'duplicate');
  assert.equal(posts, 1);
  assert.equal((await store.getAll({ a: 2 })).a, 1);
});

test('a handler that throws drops its claim so the Stripe retry runs again', async () => {
  const store = createMemoryStore();
  const event = { id: 'evt_flaky', type: 'checkout.session.completed', data: { object: {} } };
  await assert.rejects(
    processStripeEvent(store, event, async () => {
      throw new Error('boom');
    }),
    /boom/,
  );
  assert.equal(await processStripeEvent(store, event, async () => {}), 'handled');
});

test('fallback: no env => no store; static counts, no reservations', async () => {
  assert.equal(createStoreFromEnv({}), null);
  assert.equal(createStoreFromEnv({ UPSTASH_REDIS_REST_URL: 'https://x' }), null);

  // Static check still refuses to oversell a single cart...
  assert.deepEqual(await reserveCart(null, [line('a', 2, 1)]), { ok: false, slug: 'a' });
  // ...but reserves nothing, so a repeat of the same cart is allowed (today's behavior).
  assert.deepEqual(await reserveCart(null, [line('a', 1, 1)]), { ok: true, reserved: false });
  assert.deepEqual(await reserveCart(null, [line('a', 1, 1)]), { ok: true, reserved: false });
  await releaseCart(null, [{ slug: 'a', quantity: 1 }]);

  assert.deepEqual(await getInventory(null, { a: 3 }), { a: 3 });
  // Webhook without a store still posts the sale, ignores expiry.
  let posts = 0;
  const done = { id: 'e1', type: 'checkout.session.completed', data: { object: {} } };
  assert.equal(await processStripeEvent(null, done, async () => void posts++), 'handled');
  assert.equal(await processStripeEvent(null, done, async () => void posts++), 'handled');
  assert.equal(posts, 2);
  const expired = { id: 'e2', type: 'checkout.session.expired', data: { object: { metadata: { [RESERVED_FLAG]: '1' } } } };
  assert.equal(await processStripeEvent(null, expired, async () => {}), 'ignored');
});

test('getInventory falls back to static seeds when the store is unreachable', async () => {
  const store = createMemoryStore();
  store.getAll = async () => {
    throw new Error('timeout');
  };
  assert.deepEqual(await getInventory(store, { a: 3 }), { a: 3 });
});

test('parseCartSlugs reads slug:qty pairs and skips junk', () => {
  assert.deepEqual(parseCartSlugs('monolith-01:2,form-02:1'), [
    { slug: 'monolith-01', quantity: 2 },
    { slug: 'form-02', quantity: 1 },
  ]);
  assert.deepEqual(parseCartSlugs('a:0,b,:3,c:x,d:-1,e:1'), [{ slug: 'e', quantity: 1 }]);
  assert.deepEqual(parseCartSlugs(undefined), []);
});

// --- Upstash REST client, against a fake server that runs the same logic as the Lua ---

function fakeUpstash() {
  const kv = new Map();
  const calls = [];
  const fetchImpl = async (url, init) => {
    const args = JSON.parse(init.body);
    calls.push({ url, auth: init.headers.Authorization, args });
    const [cmd, ...rest] = args;
    let result;
    if (cmd === 'EVAL' && rest[0] === RESERVE_SCRIPT) {
      const [, , key, qty, seed] = rest;
      if (!kv.has(key)) kv.set(key, Number(seed));
      result = kv.get(key) >= Number(qty) ? kv.set(key, kv.get(key) - Number(qty)).get(key) : -1;
    } else if (cmd === 'EVAL' && rest[0] === RELEASE_SCRIPT) {
      const [, , key, qty] = rest;
      result = kv.has(key) ? kv.set(key, kv.get(key) + Number(qty)).get(key) : -1;
    } else if (cmd === 'MGET') {
      result = rest.map((k) => (kv.has(k) ? String(kv.get(k)) : null));
    } else if (cmd === 'SET') {
      const [key, , nx] = rest;
      if (nx === 'NX' && kv.has(key)) result = null;
      else {
        kv.set(key, 1);
        result = 'OK';
      }
    } else if (cmd === 'DEL') {
      result = kv.delete(rest[0]) ? 1 : 0;
    } else {
      return new Response(JSON.stringify({ error: `unsupported ${cmd}` }), { status: 400 });
    }
    return new Response(JSON.stringify({ result }), { status: 200 });
  };
  return { fetchImpl, calls, kv };
}

test('Upstash store: accepts either env name pair, sends bearer auth, reserves atomically', async () => {
  for (const env of [
    { UPSTASH_REDIS_REST_URL: 'https://r.example/', UPSTASH_REDIS_REST_TOKEN: 'tok' },
    { KV_REST_API_URL: 'https://r.example/', KV_REST_API_TOKEN: 'tok' },
  ]) {
    const fake = fakeUpstash();
    const store = createStoreFromEnv(env, fake.fetchImpl);
    assert.ok(store);
    assert.equal(await store.reserve('a', 1, 1), true);
    assert.equal(await store.reserve('a', 1, 1), false);
    assert.equal(fake.calls[0].url, 'https://r.example');
    assert.equal(fake.calls[0].auth, 'Bearer tok');
    assert.deepEqual(fake.calls[0].args.slice(2, 5), ['1', 'inv:a', '1']);
    assert.deepEqual(await store.getAll({ a: 9, b: 4 }), { a: 0, b: 4 });
  }
});

test('Upstash store: release only touches seeded keys; events claim once with 7-day TTL', async () => {
  const fake = fakeUpstash();
  const store = createStoreFromEnv({ KV_REST_API_URL: 'https://r', KV_REST_API_TOKEN: 't' }, fake.fetchImpl);
  await store.release('ghost', 2);
  assert.equal(fake.kv.has('inv:ghost'), false);
  await store.reserve('a', 2, 3);
  await store.release('a', 2);
  assert.equal(fake.kv.get('inv:a'), 3);

  assert.equal(await store.claimEvent('evt_1'), true);
  assert.equal(await store.claimEvent('evt_1'), false);
  assert.deepEqual(fake.calls.at(-1).args, ['SET', 'evt:evt_1', '1', 'NX', 'EX', String(7 * 24 * 60 * 60)]);
  await store.forgetEvent('evt_1');
  assert.equal(await store.claimEvent('evt_1'), true);
});

test('Upstash store: an API error surfaces as a throw (checkout fails closed)', async () => {
  const store = createStoreFromEnv(
    { KV_REST_API_URL: 'https://r', KV_REST_API_TOKEN: 't' },
    async () => new Response(JSON.stringify({ error: 'WRONGPASS' }), { status: 401 }),
  );
  await assert.rejects(store.reserve('a', 1, 1), /WRONGPASS/);
});
