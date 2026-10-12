/**
 * Live edition stock — the one place that decides whether a unit can be sold.
 *
 * Why this exists: `edition.remaining` in data/products.json is a build-time
 * snapshot. Checking against it let two buyers both pay for the last unit of a
 * small edition (hirobius/concrete#22). Stock lives in Upstash Redis instead,
 * reserved atomically when a Checkout Session is created and released if that
 * session expires or never gets created.
 *
 * Plain `.mjs` with explicit relative extensions on purpose: it runs unchanged
 * under Vercel's ESM runtime AND `node --test`, with no loader or build step.
 * Types are in inventory.d.mts. Lives in api/_lib/ because Vercel doesn't
 * deploy `_`-prefixed paths as functions (Hobby plan caps the project at 12).
 *
 * Unset env => `createStoreFromEnv` returns null and every caller falls back to
 * the static products.json counts with no reservations — the pre-#22 behavior —
 * so nothing breaks before the store is provisioned.
 */

export const EVENT_TTL_SECONDS = 7 * 24 * 60 * 60;
/** Stripe's Checkout Session minimum lifetime, plus a minute for clock/latency skew. */
export const SESSION_TTL_SECONDS = 30 * 60 + 60;
/** Stamped into session metadata so only sessions that actually reserved stock release it. */
export const RESERVED_FLAG = 'inventory_reserved';

export const inventoryKey = (slug) => `inv:${slug}`;
export const eventKey = (id) => `evt:${id}`;

/**
 * KEYS[1] = inv:<slug>, ARGV[1] = qty, ARGV[2] = seed (static remaining).
 * Returns the new count (>= 0) on success, -1 if there isn't enough stock.
 * Redis runs a script atomically, so seed + check + decrement can't interleave.
 */
export const RESERVE_SCRIPT = `
local cur = redis.call('GET', KEYS[1])
if not cur then
  redis.call('SET', KEYS[1], ARGV[2], 'NX')
  cur = redis.call('GET', KEYS[1])
end
local qty = tonumber(ARGV[1])
if tonumber(cur) >= qty then
  return redis.call('DECRBY', KEYS[1], qty)
end
return -1
`.trim();

/** INCRBY, but never conjures a key: an unseeded slug has no reservation to give back. */
export const RELEASE_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 then
  return redis.call('INCRBY', KEYS[1], ARGV[1])
end
return -1
`.trim();

/** Static counts from the catalog: { [slug]: edition.remaining }. */
export function seedsFromProducts(products) {
  return Object.fromEntries(products.map((p) => [p.slug, p.edition.remaining]));
}

// --- Stores ------------------------------------------------------------------

/**
 * In-memory store with Redis semantics. Reserve yields once before its atomic
 * section to mimic network latency, so concurrent callers genuinely interleave.
 */
export function createMemoryStore(initial = {}) {
  const counts = new Map(Object.entries(initial));
  const events = new Set();
  return {
    async reserve(slug, quantity, seed) {
      await Promise.resolve();
      if (!counts.has(slug)) counts.set(slug, seed);
      const cur = counts.get(slug);
      if (cur < quantity) return false;
      counts.set(slug, cur - quantity);
      return true;
    },
    async release(slug, quantity) {
      if (counts.has(slug)) counts.set(slug, counts.get(slug) + quantity);
    },
    async getAll(seeds) {
      return Object.fromEntries(Object.keys(seeds).map((s) => [s, counts.get(s) ?? seeds[s]]));
    },
    async claimEvent(id) {
      if (events.has(id)) return false;
      events.add(id);
      return true;
    },
    async forgetEvent(id) {
      events.delete(id);
    },
  };
}

/** Upstash Redis over its REST API — plain fetch, no dependency. */
export function createUpstashStore({ url, token, fetchImpl = fetch }) {
  const base = url.replace(/\/+$/, '');

  async function command(args) {
    const res = await fetchImpl(base, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(4000),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || json.error) {
      throw new Error(`Upstash ${args[0]} failed: ${json?.error ?? res.status}`);
    }
    return json.result;
  }

  return {
    async reserve(slug, quantity, seed) {
      const n = await command(['EVAL', RESERVE_SCRIPT, '1', inventoryKey(slug), String(quantity), String(seed)]);
      return Number(n) >= 0;
    },
    async release(slug, quantity) {
      await command(['EVAL', RELEASE_SCRIPT, '1', inventoryKey(slug), String(quantity)]);
    },
    async getAll(seeds) {
      const slugs = Object.keys(seeds);
      if (slugs.length === 0) return {};
      const values = await command(['MGET', ...slugs.map(inventoryKey)]);
      return Object.fromEntries(
        slugs.map((s, i) => {
          const n = values[i] == null ? NaN : Number(values[i]);
          return [s, Number.isFinite(n) ? n : seeds[s]];
        }),
      );
    },
    async claimEvent(id) {
      return (await command(['SET', eventKey(id), '1', 'NX', 'EX', String(EVENT_TTL_SECONDS)])) === 'OK';
    },
    async forgetEvent(id) {
      await command(['DEL', eventKey(id)]);
    },
  };
}

/**
 * The store the env asks for, or null (=> static fallback, no reservations).
 * Accepts both the names Upstash documents and the ones Vercel's Upstash
 * integration injects.
 */
export function createStoreFromEnv(env, fetchImpl) {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return createUpstashStore({ url, token, fetchImpl });
}

// --- Cart-level operations ---------------------------------------------------

/**
 * Reserve every line, all or nothing. `lines` = [{ slug, quantity, seed }].
 * Returns { ok: true, reserved } (reserved=false on the static fallback) or
 * { ok: false, slug } naming the line that ran out; anything already reserved
 * is released first. A store error also releases before rethrowing.
 */
export async function reserveCart(store, lines) {
  if (!store) {
    const short = lines.find((l) => l.seed < l.quantity);
    return short ? { ok: false, slug: short.slug } : { ok: true, reserved: false };
  }
  const done = [];
  try {
    for (const line of lines) {
      if (!(await store.reserve(line.slug, line.quantity, line.seed))) {
        await releaseCart(store, done);
        return { ok: false, slug: line.slug };
      }
      done.push(line);
    }
  } catch (err) {
    await releaseCart(store, done);
    throw err;
  }
  return { ok: true, reserved: true };
}

/** Best-effort give-back of [{ slug, quantity }]; one failed line doesn't strand the rest. */
export async function releaseCart(store, lines) {
  if (!store) return;
  await Promise.allSettled(lines.map((l) => store.release(l.slug, l.quantity)));
}

/** `metadata.cart_slugs` ("slug:qty,slug:qty") -> [{ slug, quantity }]; malformed entries are skipped. */
export function parseCartSlugs(value) {
  if (!value) return [];
  const out = [];
  for (const part of value.split(',')) {
    const i = part.lastIndexOf(':');
    const slug = part.slice(0, i).trim();
    const quantity = Number(part.slice(i + 1));
    if (i > 0 && slug && Number.isInteger(quantity) && quantity > 0) out.push({ slug, quantity });
  }
  return out;
}

/** Live counts, or the static seeds when there's no store or it's unreachable. */
export async function getInventory(store, seeds) {
  if (!store) return { ...seeds };
  try {
    return await store.getAll(seeds);
  } catch {
    return { ...seeds };
  }
}

// --- Webhook -----------------------------------------------------------------

/**
 * Run `fn` at most once per Stripe event id. If `fn` throws, the claim is
 * dropped so Stripe's retry gets another go instead of being skipped.
 */
async function once(store, eventId, fn) {
  if (!(await store.claimEvent(eventId))) return 'duplicate';
  try {
    await fn();
  } catch (err) {
    await store.forgetEvent(eventId).catch(() => {});
    throw err;
  }
  return 'handled';
}

/**
 * Apply a verified Stripe event to stock. `notify(session)` posts the sale to
 * Discord. Returns 'handled' | 'duplicate' | 'ignored'.
 *
 * - completed: stock was already taken at reservation, so only notify; the
 *   event-id claim stops a replay double-posting.
 * - expired: give the reserved quantities back (only if this session reserved).
 */
export async function processStripeEvent(store, event, notify) {
  const session = event.data.object;
  if (event.type === 'checkout.session.completed') {
    if (!store) {
      await notify(session);
      return 'handled';
    }
    return once(store, event.id, () => notify(session));
  }
  if (event.type === 'checkout.session.expired') {
    if (!store || session.metadata?.[RESERVED_FLAG] !== '1') return 'ignored';
    const lines = parseCartSlugs(session.metadata?.cart_slugs);
    return once(store, event.id, async () => {
      // Not releaseCart: a failed INCRBY must fail the event so Stripe retries.
      await Promise.all(lines.map((l) => store.release(l.slug, l.quantity)));
    });
  }
  return 'ignored';
}
