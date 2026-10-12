export const EVENT_TTL_SECONDS: number;
export const SESSION_TTL_SECONDS: number;
export const RESERVED_FLAG: string;
export const RESERVE_SCRIPT: string;
export const RELEASE_SCRIPT: string;

export const inventoryKey: (slug: string) => string;
export const eventKey: (id: string) => string;

export type Seeds = Record<string, number>;
export type CartLine = { slug: string; quantity: number };
export type SeededLine = CartLine & { seed: number };

export interface InventoryStore {
  /** Atomically take `quantity` (seeding from `seed` if unseen). False if short. */
  reserve(slug: string, quantity: number, seed: number): Promise<boolean>;
  release(slug: string, quantity: number): Promise<void>;
  getAll(seeds: Seeds): Promise<Seeds>;
  /** True the first time an event id is seen (7-day memory). */
  claimEvent(id: string): Promise<boolean>;
  forgetEvent(id: string): Promise<void>;
}

export function seedsFromProducts(products: { slug: string; edition: { remaining: number } }[]): Seeds;
export function createMemoryStore(initial?: Seeds): InventoryStore;
export function createUpstashStore(opts: {
  url: string;
  token: string;
  fetchImpl?: typeof fetch;
}): InventoryStore;
export function createStoreFromEnv(
  env: Record<string, string | undefined>,
  fetchImpl?: typeof fetch,
): InventoryStore | null;

export function reserveCart(
  store: InventoryStore | null,
  lines: SeededLine[],
): Promise<{ ok: true; reserved: boolean } | { ok: false; slug: string }>;
export function releaseCart(store: InventoryStore | null, lines: CartLine[]): Promise<void>;
export function parseCartSlugs(value: string | undefined | null): CartLine[];
export function getInventory(store: InventoryStore | null, seeds: Seeds): Promise<Seeds>;

export type StripeEventLike = {
  id: string;
  type: string;
  data: { object: { metadata?: Record<string, string> | null } & Record<string, any> };
};
export function processStripeEvent(
  store: InventoryStore | null,
  event: StripeEventLike,
  notify: (session: any) => Promise<void>,
): Promise<'handled' | 'duplicate' | 'ignored'>;
