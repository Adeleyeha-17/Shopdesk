// The frame around the vendor's sign-in and set-up screens: the ShopDesk header and the content.
import React from 'react';

export function VendorFrame({ children, right }) {
  return (
    <div className="app">
      <header className="top">
        <div className="top-row">
          <div className="brand">
            <i aria-hidden="true" />
            ShopDesk
          </div>
          {right}
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
