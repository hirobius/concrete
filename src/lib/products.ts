import data from '../../data/products.json';

/**
 * One photograph. `alt` is per-image and required, because a gallery whose
 * every frame is described with the product's name tells a screen-reader user
 * nothing about what changed between them — which is the whole reason the
 * gallery exists. Describe THIS frame: the angle, the crop, the detail.
 */
export type ProductImage = {
  src: string;
  alt: string;
};

/** A guest maker, for consigned work. Absent means it is Adrian's own. */
export type ProductArtist = {
  slug: string;
  name: string;
  blurb?: string;
  link?: string;
  /** Percentage of the sale owed to the maker. */
  splitPercent: number;
};

export type Product = {
  slug: string;
  title: string;
  subtitle: string;
  story: string;
  dimensions: string;
  weightLbs: number;
  materials: string[];
  priceUsd: number;
  stripePriceId: string;
  edition: { total: number; remaining: number };
  status: 'available' | 'sold-out' | 'archived';
  /** First entry is the hero. Never empty. */
  images: ProductImage[];
  artist?: ProductArtist;
};

export const products: Product[] = data.products as Product[];

export function getProduct(slug: string): Product | undefined {
  return products.find((p) => p.slug === slug);
}

export function isAvailable(p: Product): boolean {
  return p.status === 'available' && p.edition.remaining > 0;
}

/**
 * The hero image. Derived rather than stored: a `primaryImage` field sitting
 * beside `images[0]` is two places to change and one place to forget.
 */
export function primaryImage(p: Product): ProductImage | undefined {
  return p.images[0];
}

export function editionLabel(p: Product): string {
  const { total, remaining } = p.edition;
  if (remaining === 0) return 'Edition complete';
  if (total <= 30) return `${remaining} of ${total} remaining`;
  return `Edition of ${total}`;
}
