// The frame around every customer page: the ShopDesk header (or the shop's name) and the page content.
import React from 'react';
import { goBack } from '../lib/helpers.js';

// titleHref: the title is a link (a shop's name goes to the shop). right: the buttons at the top right.
// back: a back arrow before the title; the address it goes to when the page wasn't opened from another ShopDesk page.
// tabs: the bar at the bottom (customer/CustomerTabs.jsx). kind: an extra class on the page.
export function Page({ children, title, titleHref, right, back, tabs, kind }) {
  const Brand = titleHref ? 'a' : 'div';
  return (
    <div className={kind ? 'app ' + kind : 'app'}>
      <header className="top cust-top">
        <div className="top-row">
          <div className="top-left">
            {back && (
              <button className="back-btn" onClick={() => goBack(back)} aria-label="Back">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M15 5l-7 7 7 7" />
                </svg>
              </button>
            )}
            <Brand className="brand can-wrap" href={titleHref}>
              {!back && <i aria-hidden="true" />}
              {title || 'ShopDesk'}
            </Brand>
          </div>
          {right && <div className="top-actions">{right}</div>}
        </div>
      </header>
      <main className={tabs ? 'with-tabs' : undefined}>{children}</main>
      {tabs}
    </div>
  );
}
