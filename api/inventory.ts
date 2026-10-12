import type { VercelRequest, VercelResponse } from '@vercel/node';
import productData from '../data/products.json' with { type: 'json' };
import { createStoreFromEnv, getInventory, seedsFromProducts } from './_lib/inventory.mjs';

const products = (productData as { products: { slug: string; edition: { remaining: number } }[] }).products;

// GET /api/inventory -> { [slug]: remaining }. Live from Upstash when
// configured, otherwise the static products.json counts.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const inventory = await getInventory(createStoreFromEnv(process.env), seedsFromProducts(products));
  res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=30');
  res.status(200).json(inventory);
}
