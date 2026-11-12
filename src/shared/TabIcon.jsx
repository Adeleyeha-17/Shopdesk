// The icons in the bottom tab bars (customers and shop owners): an outline, or filled for the tab you're on.
// In the filled ones, .cut and .cutline are drawn in the bar's colour (the shop door, the receipt lines, the box edges).
import React from 'react';

const SHOP_OUT = <path d="M4 9l1-5h14l1 5M4 9h16v11H4zM9 20v-6h6v6" />;
const SHOP_ON = (
  <>
    <path className="f" d="M4.3 8.4 5.2 4h13.6l.9 4.4z" />
    <path className="f" d="M4.6 11h14.8v9H4.6z" />
    <path className="cut" d="M9.8 20.7v-5.3h4.4v5.3z" />
  </>
);

const ICONS = {
  shops: [SHOP_OUT, SHOP_ON],
  shop: [SHOP_OUT, SHOP_ON],
  orders: [
    <path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6" />,
    <>
      <path className="f" d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
      <path className="cutline" d="M9 8h6M9 12h6" />
    </>,
  ],
  cart: [
    <>
      <path d="M3 4h2.2l2.3 10.6a1.6 1.6 0 0 0 1.6 1.3h8.1a1.6 1.6 0 0 0 1.6-1.2L20.6 8H6" />
      <circle cx="9.5" cy="19.6" r="1.2" />
      <circle cx="17" cy="19.6" r="1.2" />
    </>,
    <>
      <path d="M3 4h2.2l2.3 10.6" />
      <path className="f" d="M6.3 8h14.3l-1.8 6.7a1.6 1.6 0 0 1-1.6 1.2H9.1a1.6 1.6 0 0 1-1.6-1.3z" />
      <circle className="f" cx="9.5" cy="19.6" r="1.5" />
      <circle className="f" cx="17" cy="19.6" r="1.5" />
    </>,
  ],
  account: [
    <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20c1.4-3.3 4.2-5 7.5-5s6.1 1.7 7.5 5" />,
    <>
      <circle className="f" cx="12" cy="8" r="4" />
      <path className="f" d="M4.5 20c1.4-3.3 4.2-5 7.5-5s6.1 1.7 7.5 5z" />
    </>,
  ],
  sales: [
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
    <>
      <rect className="f" x="2.6" y="10" width="3.6" height="10.6" rx="1" />
      <rect className="f" x="8.2" y="3.6" width="3.6" height="17" rx="1" />
      <rect className="f" x="13.8" y="12.6" width="3.6" height="8" rx="1" />
    </>,
  ],
  stock: [
    <path d="M3 7l9-4 9 4-9 4zM3 7v10l9 4 9-4V7M12 11v10" />,
    <>
      <path className="f" d="M3 7l9-4 9 4v10l-9 4-9-4z" />
      <path className="cutline" d="M3.6 7.3 12 11l8.4-3.7M12 11v9.6" />
    </>,
  ],
};

export function TabIcon({ name, on }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {ICONS[name][on ? 1 : 0]}
    </svg>
  );
}
