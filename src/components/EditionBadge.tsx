import type { Product } from '../lib/products';
import { editionLabel } from '../lib/products';
import { useRemaining } from '../lib/inventory';

export default function EditionBadge({ product }: { product: Product }) {
  const remaining = useRemaining(product);
  const label = editionLabel(product, remaining);
  const soldOut = remaining === 0;
  return (
    <span
      className={`inline-flex items-center text-eyebrow uppercase ${
        soldOut ? 'text-disabled' : 'text-secondary'
      }`}
    >
      {label}
    </span>
  );
}
