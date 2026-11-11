// The frame around every customer page: the ShopDesk header (or the shop's name) and the page content.
import React from 'react';

// titleHref: the title is a link (a shop's name goes to the shop). right: the buttons at the top right.
// kind: an extra class on the page.
export function Page({ children, title, titleHref, right, kind }) {
  const Brand = titleHref ? 'a' : 'div';
  return (
    <div className={kind ? 'app ' + kind : 'app'}>
      <header className="top cust-top">
        <div className="top-row">
          <Brand className="brand can-wrap" href={titleHref}>
            <i aria-hidden="true" />
            {title || 'ShopDesk'}
          </Brand>
          {right && <div className="top-actions">{right}</div>}
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
