import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { CartProvider } from './lib/cart';
import { InventoryProvider } from './lib/inventory';
import './styles/globals.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <InventoryProvider>
        <CartProvider>
          <App />
        </CartProvider>
      </InventoryProvider>
    </BrowserRouter>
  </React.StrictMode>
);
