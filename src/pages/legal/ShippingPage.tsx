export default function ShippingPage() {
  return (
    <article className="container-page py-20 max-w-editorial">
      <h1 className="text-h1">Shipping Policy</h1>
      <p className="mt-2 text-eyebrow text-secondary">DRAFT — review with counsel before launch.</p>

      <div className="mt-10 space-y-6 text-primary text-body">
        <section>
          <h2 className="text-h3 text-primary">Where we ship</h2>
          <p>
            We currently ship to all 50 U.S. states. International orders are
            not yet available — please email if you'd like to be notified
            when they open.
          </p>
        </section>
        <section>
          <h2 className="text-h3 text-primary">Processing time</h2>
          <p>
            Each Form is hand-cast to order. Orders leave our Spokane, WA
            studio within 3–5 business days of purchase. Carrier transit time
            below is additional.
          </p>
        </section>
        <section>
          <h2 className="text-h3 text-primary">Carriers &amp; transit time</h2>
          <p>
            We ship via USPS or UPS, selected by package size and
            destination. Estimated transit time is 3–7 business days,
            included in the listed price — there is no separate shipping fee
            at checkout.
          </p>
        </section>
        <section>
          <h2 className="text-h3 text-primary">Local pickup</h2>
          <p>
            Local pickup is offered at checkout for buyers in the Spokane, WA
            area, ready in 1–3 business days. Pickup details are emailed with
            the order confirmation.
          </p>
        </section>
        <section>
          <h2 className="text-h3 text-primary">Sales tax</h2>
          <p>
            We collect Washington State sales tax at a fixed rate for our
            Spokane location on every order, charged at checkout. We do not
            use destination-based automatic tax calculation (Stripe Tax).
          </p>
        </section>
        <section>
          <h2 className="text-h3 text-primary">Damage or loss in transit</h2>
          <p>
            Each piece is wrapped and packed by hand. If a piece arrives
            damaged or is lost in transit, see our{' '}
            <a href="/legal/refunds" className="underline">Refund &amp; Return Policy</a>{' '}
            for the remedy.
          </p>
        </section>
      </div>
    </article>
  );
}
