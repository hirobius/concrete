# Sale flow

1. The visitor adds Forms to the cart drawer. The cart state is in localStorage.
2. The Checkout button sends the cart to `/api/create-checkout-session`.
3. Stripe Checkout (hosted) takes the payment and the shipping address.
4. Stripe calls `/api/stripe-webhook`. It lowers `edition.remaining` in `products.json`.
   The change is committed through the build, so the count is eventually consistent.
5. A Discord webhook posts the sale to the `#sales` channel.
6. Stripe emails the payment receipt to the buyer and to the shop owner.

## Environment

Put these names in `.env.local`. Never commit the values.

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_TAX_RATE_ID`
- `DISCORD_SALES_WEBHOOK_URL`
- `VITE_SITE_URL`

[SETUP.md](../SETUP.md) says where each value comes from.

## Test the webhook on your computer

```bash
stripe listen --forward-to localhost:5180/api/stripe-webhook
```

Copy the signing secret that the command prints into `STRIPE_WEBHOOK_SECRET`.
