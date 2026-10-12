import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { main, locateProducts, setStripePriceId, keyMode } from './stripe-sync.mjs';

// ── fixtures ────────────────────────────────────────────────────────────────

function product(slug, n, overrides = {}) {
  return {
    slug,
    title: `Form ${n}`,
    subtitle: `Cast concrete object ${n}`,
    story: 'A hand-poured form.',
    dimensions: '120 × 80 × 80 mm',
    weightLbs: 2.1,
    materials: ['GFRC concrete'],
    priceUsd: 88,
    stripePriceId: `price_TODO_form_0${n}`,
    edition: { total: 24, remaining: 11 },
    status: 'available',
    images: [{ src: `/products/${slug}/01.jpg`, alt: `${slug} straight on` }],
    ...overrides,
  };
}

/** Same on-disk shape as data/products.json: 2-space JSON, \u escapes, trailing newline. */
function fixtureText(products) {
  const json = JSON.stringify({ _comment: 'fixture', products }, null, 2) + '\n';
  return json.replace(/[^\x00-\x7f]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

function tempCatalog(products) {
  const dir = mkdtempSync(path.join(tmpdir(), 'stripe-sync-'));
  const file = path.join(dir, 'products.json');
  writeFileSync(file, fixtureText(products));
  return { dir, file, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const TEST_KEY = 'rk_test_fake';
const LIVE_KEY = 'sk_live_fake';

/** In-memory stand-in for the slice of the Stripe SDK the script uses. */
function fakeStripe() {
  const products = [];
  const prices = [];
  const writes = [];
  let seq = 0;
  const notFound = () => Object.assign(new Error('No such price'), { type: 'StripeInvalidRequestError', code: 'resource_missing' });
  const client = {
    products: {
      // Two per page, so pagination is actually exercised.
      async list({ limit, starting_after } = {}) {
        const start = starting_after ? products.findIndex((p) => p.id === starting_after) + 1 : 0;
        const size = Math.min(limit ?? 100, 2);
        const data = products.slice(start, start + size);
        return { data: data.map((d) => ({ ...d })), has_more: start + size < products.length };
      },
      async create(params) {
        writes.push(['products.create', params]);
        const row = { id: `prod_${++seq}`, active: true, default_price: null, description: null, ...params };
        products.push(row);
        return { ...row };
      },
      async update(id, params) {
        writes.push(['products.update', id, params]);
        Object.assign(products.find((p) => p.id === id), params);
        return {};
      },
    },
    prices: {
      async retrieve(id) {
        const row = prices.find((p) => p.id === id);
        if (!row) throw notFound();
        return { ...row };
      },
      async create(params) {
        writes.push(['prices.create', params]);
        const row = { id: `price_real_${++seq}`, active: true, ...params };
        prices.push(row);
        return { ...row };
      },
      async update(id, params) {
        writes.push(['prices.update', id, params]);
        Object.assign(prices.find((p) => p.id === id), params);
        return {};
      },
    },
  };
  return { client, products, prices, writes };
}

async function run(fake, file, args = [], env = { STRIPE_SECRET_KEY: TEST_KEY }) {
  const lines = [];
  let created = 0;
  const code = await main({
    argv: args,
    env,
    catalogPath: file,
    log: (l) => lines.push(l),
    createClient: async () => {
      created++;
      return fake.client;
    },
  });
  return { code, out: lines.join('\n'), created };
}

const readCatalog = (file) => JSON.parse(readFileSync(file, 'utf8')).products;

// ── behaviour ───────────────────────────────────────────────────────────────

test('creates the Product and Price when missing, and writes the id back', async () => {
  const cat = tempCatalog([product('form-01', 1), product('form-02', 2, { priceUsd: 140.5 })]);
  const fake = fakeStripe();
  try {
    const { code } = await run(fake, cat.file);
    assert.equal(code, 0);

    assert.equal(fake.products.length, 2);
    assert.deepEqual(fake.products[0].metadata, { slug: 'form-01' });
    assert.equal(fake.products[0].name, 'Form 1');
    assert.equal(fake.products[0].description, 'Cast concrete object 1');
    assert.equal(fake.products[0].images, undefined, 'no SITE_URL -> no images');

    assert.equal(fake.prices.length, 2);
    assert.equal(fake.prices[0].unit_amount, 8800);
    assert.equal(fake.prices[0].currency, 'usd');
    assert.equal(fake.prices[1].unit_amount, 14050);
    assert.equal(fake.products[0].default_price, fake.prices[0].id);

    const written = readCatalog(cat.file);
    assert.equal(written[0].stripePriceId, fake.prices[0].id);
    assert.equal(written[1].stripePriceId, fake.prices[1].id);
  } finally {
    cat.cleanup();
  }
});

test('write-back changes only the id line: key order, escapes and trailing newline survive', async () => {
  const cat = tempCatalog([product('form-01', 1)]);
  const fake = fakeStripe();
  try {
    const before = readFileSync(cat.file, 'utf8');
    await run(fake, cat.file);
    const after = readFileSync(cat.file, 'utf8');
    assert.equal(after, before.replace('"price_TODO_form_01"', JSON.stringify(fake.prices[0].id)));
    assert.ok(after.includes('\\u00d7'), 'unicode escapes are preserved, not rewritten');
    assert.ok(after.endsWith('}\n'));
  } finally {
    cat.cleanup();
  }
});

test('passes the absolute hero URL only when SITE_URL is set', async () => {
  const cat = tempCatalog([
    product('form-01', 1),
    product('form-02', 2, { images: [{ src: 'data:image/svg+xml;base64,AAAA', alt: 'placeholder' }] }),
  ]);
  const fake = fakeStripe();
  try {
    await run(fake, cat.file, [], { STRIPE_SECRET_KEY: TEST_KEY, SITE_URL: 'https://hirobius.studio/' });
    assert.deepEqual(fake.products[0].images, ['https://hirobius.studio/products/form-01/01.jpg']);
    assert.equal(fake.products[1].images, undefined, 'a data: URI is not a fetchable image');
  } finally {
    cat.cleanup();
  }
});

test('a second run with nothing changed creates and updates nothing', async () => {
  const cat = tempCatalog([product('form-01', 1), product('form-02', 2), product('form-03', 3)]);
  const fake = fakeStripe();
  try {
    await run(fake, cat.file);
    const diskAfterFirst = readFileSync(cat.file, 'utf8');
    fake.writes.length = 0;

    const { code, out } = await run(fake, cat.file);
    assert.equal(code, 0);
    assert.deepEqual(fake.writes, [], 'no Stripe writes on the second run');
    assert.equal(readFileSync(cat.file, 'utf8'), diskAfterFirst, 'catalog untouched');
    assert.match(out, /0 changed, 3 up to date/);
  } finally {
    cat.cleanup();
  }
});

test('a changed price creates a new Price, makes it default, and archives the old one', async () => {
  const cat = tempCatalog([product('form-01', 1)]);
  const fake = fakeStripe();
  try {
    await run(fake, cat.file);
    const oldPriceId = fake.prices[0].id;

    // Edit the catalog price.
    const edited = readFileSync(cat.file, 'utf8').replace('"priceUsd": 88', '"priceUsd": 95');
    writeFileSync(cat.file, edited);
    fake.writes.length = 0;

    const { code } = await run(fake, cat.file);
    assert.equal(code, 0);
    assert.equal(fake.prices.length, 2);
    const fresh = fake.prices[1];
    assert.equal(fresh.unit_amount, 9500);
    assert.equal(fake.prices[0].active, false, 'old price archived');
    assert.equal(fake.products[0].default_price, fresh.id);
    assert.equal(readCatalog(cat.file)[0].stripePriceId, fresh.id);

    // Default is switched BEFORE the old price is archived (Stripe refuses otherwise).
    const ops = fake.writes.map((w) => w[0] + (w[1] === oldPriceId ? ':old' : ''));
    assert.ok(ops.indexOf('products.update') < ops.indexOf('prices.update:old'));

    // And the run after that is a no-op again.
    fake.writes.length = 0;
    await run(fake, cat.file);
    assert.deepEqual(fake.writes, []);
  } finally {
    cat.cleanup();
  }
});

test('updates name/description when they drifted', async () => {
  const cat = tempCatalog([product('form-01', 1)]);
  const fake = fakeStripe();
  try {
    await run(fake, cat.file);
    fake.products[0].name = 'Old name';
    fake.writes.length = 0;
    await run(fake, cat.file);
    assert.deepEqual(fake.writes, [['products.update', fake.products[0].id, { name: 'Form 1' }]]);
  } finally {
    cat.cleanup();
  }
});

test('adopts an existing correct default price instead of creating a twin', async () => {
  const cat = tempCatalog([product('form-01', 1)]);
  const fake = fakeStripe();
  try {
    await run(fake, cat.file);
    const priceId = fake.prices[0].id;
    // Simulate: Stripe is right, but the disk write was lost.
    writeFileSync(cat.file, readFileSync(cat.file, 'utf8').replace(priceId, 'price_TODO_form_01'));
    fake.writes.length = 0;

    await run(fake, cat.file);
    assert.equal(fake.prices.length, 1, 'no second price');
    assert.deepEqual(fake.writes, []);
    assert.equal(readCatalog(cat.file)[0].stripePriceId, priceId);
  } finally {
    cat.cleanup();
  }
});

test('--slug touches only that product', async () => {
  const cat = tempCatalog([product('form-01', 1), product('form-02', 2)]);
  const fake = fakeStripe();
  try {
    await run(fake, cat.file, ['--slug', 'form-02']);
    assert.equal(fake.products.length, 1);
    assert.equal(fake.products[0].metadata.slug, 'form-02');
    const written = readCatalog(cat.file);
    assert.equal(written[0].stripePriceId, 'price_TODO_form_01');
    assert.equal(written[1].stripePriceId, fake.prices[0].id);

    const unknown = await run(fake, cat.file, ['--slug', 'nope']);
    assert.equal(unknown.code, 1);
    assert.match(unknown.out, /nope: no product with that slug/);
    assert.match(unknown.out, /fix:/);
  } finally {
    cat.cleanup();
  }
});

test('--dry-run prints the plan and writes nothing to Stripe or disk', async () => {
  const cat = tempCatalog([product('form-01', 1), product('form-02', 2)]);
  const fake = fakeStripe();
  try {
    const before = readFileSync(cat.file, 'utf8');
    const { code, out } = await run(fake, cat.file, ['--dry-run']);
    assert.equal(code, 0);
    assert.deepEqual(fake.writes, []);
    assert.equal(fake.products.length, 0);
    assert.equal(readFileSync(cat.file, 'utf8'), before);
    assert.match(out, /would create Product "Form 1"/);
    assert.match(out, /would create USD Price 8800¢/);
    assert.match(out, /would record .* in data\/products\.json/);
  } finally {
    cat.cleanup();
  }
});

test('--dry-run against existing objects still writes nothing', async () => {
  const cat = tempCatalog([product('form-01', 1)]);
  const fake = fakeStripe();
  try {
    await run(fake, cat.file);
    writeFileSync(cat.file, readFileSync(cat.file, 'utf8').replace('"priceUsd": 88', '"priceUsd": 95'));
    const before = readFileSync(cat.file, 'utf8');
    fake.writes.length = 0;
    const { out } = await run(fake, cat.file, ['--dry-run']);
    assert.deepEqual(fake.writes, []);
    assert.equal(readFileSync(cat.file, 'utf8'), before);
    assert.match(out, /would create USD Price 9500¢/);
    assert.match(out, /would archive old price/);
  } finally {
    cat.cleanup();
  }
});

test('missing STRIPE_SECRET_KEY: skips with the exact message and exit 0', async () => {
  const cat = tempCatalog([product('form-01', 1)]);
  const fake = fakeStripe();
  try {
    const before = readFileSync(cat.file, 'utf8');
    const { code, out, created } = await run(fake, cat.file, [], {});
    assert.equal(code, 0);
    assert.equal(out, 'stripe-sync: skipped — STRIPE_SECRET_KEY not set (see SETUP.md §3)');
    assert.equal(created, 0, 'no client is even constructed');
    assert.equal(readFileSync(cat.file, 'utf8'), before);
  } finally {
    cat.cleanup();
  }
});

test('live key without --confirm-live refuses before touching Stripe or disk', async () => {
  const cat = tempCatalog([product('form-01', 1)]);
  const fake = fakeStripe();
  try {
    const before = readFileSync(cat.file, 'utf8');
    const { code, out, created } = await run(fake, cat.file, [], { STRIPE_SECRET_KEY: LIVE_KEY });
    assert.equal(code, 1);
    assert.match(out, /LIVE MODE/);
    assert.match(out, /refusing to write with a LIVE key without --confirm-live/);
    assert.match(out, /fix:/);
    assert.equal(created, 0);
    assert.deepEqual(fake.writes, []);
    assert.equal(readFileSync(cat.file, 'utf8'), before);
  } finally {
    cat.cleanup();
  }
});

test('live key: --dry-run is allowed, --confirm-live writes', async () => {
  const cat = tempCatalog([product('form-01', 1)]);
  const fake = fakeStripe();
  try {
    const dry = await run(fake, cat.file, ['--dry-run'], { STRIPE_SECRET_KEY: LIVE_KEY });
    assert.equal(dry.code, 0);
    assert.deepEqual(fake.writes, []);

    const live = await run(fake, cat.file, ['--confirm-live'], { STRIPE_SECRET_KEY: LIVE_KEY });
    assert.equal(live.code, 0);
    assert.match(live.out, /LIVE MODE/);
    assert.equal(fake.prices.length, 1);
  } finally {
    cat.cleanup();
  }
});

test('test mode is announced; a pk_ key is rejected with a fix', async () => {
  const cat = tempCatalog([product('form-01', 1)]);
  const fake = fakeStripe();
  try {
    const t = await run(fake, cat.file, ['--dry-run']);
    assert.match(t.out, /TEST mode/);
    const bad = await run(fake, cat.file, [], { STRIPE_SECRET_KEY: 'pk_test_nope' });
    assert.equal(bad.code, 1);
    assert.match(bad.out, /fix:/);
  } finally {
    cat.cleanup();
  }
});

test('a Stripe failure names the product and the fix, and exits 1 without losing the others', async () => {
  const cat = tempCatalog([product('form-01', 1), product('form-02', 2)]);
  const fake = fakeStripe();
  const realCreate = fake.client.products.create;
  fake.client.products.create = async (params) => {
    if (params.metadata.slug === 'form-01') {
      throw Object.assign(new Error('Your key does not have permission'), { type: 'StripePermissionError' });
    }
    return realCreate(params);
  };
  try {
    const { code, out } = await run(fake, cat.file);
    assert.equal(code, 1);
    assert.match(out, /form-01: Your key does not have permission/);
    assert.match(out, /Products: Write and Prices: Write/);
    assert.equal(readCatalog(cat.file)[1].stripePriceId, fake.prices[0].id, 'form-02 still synced');
  } finally {
    cat.cleanup();
  }
});

// ── helpers ─────────────────────────────────────────────────────────────────

test('keyMode reads the prefix', () => {
  assert.equal(keyMode('sk_test_x'), 'test');
  assert.equal(keyMode('rk_test_x'), 'test');
  assert.equal(keyMode('sk_live_x'), 'live');
  assert.equal(keyMode('rk_live_x'), 'live');
  assert.equal(keyMode('pk_live_x'), null);
});

test('setStripePriceId ignores nested slugs and inserts a missing key', () => {
  const withArtist = product('form-01', 1, { artist: { slug: 'form-02', name: 'A', splitPercent: 50 } });
  const second = product('form-02', 2);
  delete second.stripePriceId;
  const text = fixtureText([withArtist, second]);
  assert.equal(locateProducts(text).length, 2);

  const out = setStripePriceId(setStripePriceId(text, 0, 'price_real_a'), 1, 'price_real_b');
  const parsed = JSON.parse(out).products;
  assert.equal(parsed[0].stripePriceId, 'price_real_a');
  assert.equal(parsed[0].artist.slug, 'form-02');
  assert.equal(parsed[1].stripePriceId, 'price_real_b');
});

test('also handles a bare-array catalog', () => {
  const text = JSON.stringify([product('form-01', 1)], null, 2) + '\n';
  const out = setStripePriceId(text, 0, 'price_real_a');
  assert.equal(JSON.parse(out)[0].stripePriceId, 'price_real_a');
});
