import { Link } from 'react-router-dom';

export default function CheckoutCancelPage() {
  return (
    <article className="container-page py-32 max-w-editorial text-center">
      <h1 className="text-h1">
        Checkout cancelled
      </h1>
      <p className="mt-6 text-primary text-body">Your cart is still saved if you'd like to come back to it.</p>
      <div className="mt-10">
        <Link to="/" className="btn-ghost">Back to studio</Link>
      </div>
    </article>
  );
}
