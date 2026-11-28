// ShopDesk on Instagram, TikTok, X and Facebook: on the Help page and the Shop tab.
import React from 'react';

export const SOCIAL = [
  ['Instagram', 'https://instagram.com/shopdeskng'],
  ['TikTok', 'https://www.tiktok.com/@shopdeskng'],
  ['X', 'https://x.com/shopdeskng'],
  ['Facebook', 'https://www.facebook.com/61596838162757'],
];

export function FollowShopDesk({ boxed }) {
  return (
    <section className={'card' + (boxed ? ' boxed' : '') + ' social'}>
      <h2>Follow ShopDesk</h2>
      <div className="social-links">
        {SOCIAL.map(([name, url]) => (
          <a key={name} href={url} target="_blank" rel="noopener noreferrer">
            {name}
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 17L17 7M9 7h8v8" />
            </svg>
          </a>
        ))}
      </div>
    </section>
  );
}
