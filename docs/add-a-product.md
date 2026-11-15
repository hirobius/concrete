# Add a product

A product is called a Form. The planned domain is `hirobius.studio`.

```bash
pnpm catalog:add
```

The tool asks for each field and validates the entry before it writes. The schema is
`scripts/lib/product-schema.mjs`. The rules, and how to edit an entry, are in
[CATALOG-AUTHORING.md](CATALOG-AUTHORING.md).

1. Run `pnpm catalog:add`. Give the title, subtitle, story, dimensions, materials, price,
   edition counts and images.
2. Put the product photos in `public/products/<slug>/`. See [PRODUCT-IMAGES.md](PRODUCT-IMAGES.md).
3. Create the Stripe product and price in the Stripe Dashboard.
4. Paste the `price_xxx` id when the tool asks. To add it later, run
   `pnpm catalog:add -- --edit <slug>`.
5. Run `pnpm check:launch`. It finds placeholders before they ship.
6. Commit. Vercel builds the site again and the product is live.
