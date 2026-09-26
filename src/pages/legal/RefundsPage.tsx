export default function RefundsPage() {
  return (
    <article className="container-page py-20 max-w-editorial">
      <h1 className="text-3xl md:text-4xl">Refund &amp; Return Policy</h1>
      <p className="mt-2 text-xs uppercase tracking-caps text-secondary">DRAFT — review with counsel before launch.</p>

      <div className="mt-10 space-y-6 text-primary leading-relaxed text-sm">
        <section>
          <h2 className="text-lg text-primary">Made-to-order, final sale</h2>
          <p>
            Each Form is hand-cast to order as part of a small, numbered
            edition. Because of this, we do not accept returns or exchanges
            for change of mind, wrong size, or similar buyer-side reasons —
            all sales are final except as described below. Washington State
            does not require a cooling-off or mandatory-refund period for
            this type of retail sale; this posted policy governs.
          </p>
        </section>
        <section>
          <h2 className="text-lg text-primary">Damaged or lost in transit</h2>
          <p>
            If a piece arrives damaged, or does not arrive, email{' '}
            <a href="mailto:studio@hirobius.com" className="underline">studio@hirobius.com</a>{' '}
            within 7 days of delivery (or the expected delivery date, for a
            lost package) with photographs. We'll arrange a replacement,
            subject to edition availability, or a full refund to the original
            payment method.
          </p>
        </section>
        <section>
          <h2 className="text-lg text-primary">Defects</h2>
          <p>
            Hand-cast surface texture, slight color shift, and small
            inclusions are inherent to the material and are not defects —
            see <a href="/legal/terms" className="underline">Terms of Sale</a>{' '}
            §2. A genuine manufacturing defect (crack, structural failure) is
            covered the same as damage in transit, above.
          </p>
        </section>
        <section>
          <h2 className="text-lg text-primary">How refunds are issued</h2>
          <p>
            Approved refunds are issued to the original payment method
            through Stripe, typically within 5–10 business days of approval.
          </p>
        </section>
      </div>
    </article>
  );
}
