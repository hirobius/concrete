import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import type { Product } from './products';

/** { [slug]: remaining } from GET /api/inventory. Empty until it loads (or if it never does). */
type Inventory = Record<string, number>;

const InventoryContext = createContext<Inventory>({});

/**
 * Fetches live stock once at app level. Every failure (no API in `vite dev`,
 * offline, a malformed body) is silent: consumers fall back to the static
 * `edition.remaining` baked into the build.
 */
export function InventoryProvider({ children }: { children: ReactNode }) {
  const [inventory, setInventory] = useState<Inventory>({});

  useEffect(() => {
    let cancelled = false;
    fetch('/api/inventory')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: unknown) => {
        if (cancelled || !data || typeof data !== 'object') return;
        const live: Inventory = {};
        for (const [slug, n] of Object.entries(data)) {
          if (typeof n === 'number' && Number.isFinite(n)) live[slug] = n;
        }
        setInventory(live);
      })
      .catch(() => {
        // static fallback
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return <InventoryContext.Provider value={inventory}>{children}</InventoryContext.Provider>;
}

/** For lists: a lookup of live units remaining, falling back to the build-time count. */
export function useRemainingLookup(): (product: Product) => number {
  const inventory = useContext(InventoryContext);
  return (product) => inventory[product.slug] ?? product.edition.remaining;
}

/** Live units remaining for one product, or the build-time count if we have none. */
export function useRemaining(product: Product): number {
  return useRemainingLookup()(product);
}
