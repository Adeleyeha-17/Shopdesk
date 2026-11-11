// The frame around every customer page: the ShopDesk header (or the shop's name) and the page content.
import React from 'react';

// kind: an extra class on the page (e.g. 'me' for My orders and Account, whose top bars share one height).
export function Page({ children, title, right, kind }) {
  return (
    <div className={kind ? 'app ' + kind : 'app'}>
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
