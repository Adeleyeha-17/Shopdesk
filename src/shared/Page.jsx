// The frame around every customer page: the ShopDesk header (or the shop's name) and the page content.
import React from 'react';

export function Page({ children, title, right }) {
  return (
    <div className="app">
      <header className="top">
        <div className="top-row">
          <div className="brand can-wrap">
            <i aria-hidden="true" />
            {title || 'ShopDesk'}
          </div>
          {right}
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
