// Shops tab > From shops you follow: news from the shops this customer follows or has ordered from ("Black Friday: 15%
// off with code BF15."), newest first. Seeing it here reads the news alerts.
import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/database.js';
import { photoUrl } from '../lib/photos.js';

const TAG = { new: 'New', sale: 'Sale', black_friday: 'Black Friday', restock: 'Back in stock' };
const agoText = (at) => {
  const m = Math.floor((Date.now() - new Date(at).getTime()) / 6e4);
  if (m < 60) return m <= 1 ? 'just now' : `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
};

export function ShopFeed({ uid, stamp, markRead }) {
  const [feed, setFeed] = useState([]);
  useEffect(() => {
    if (!uid) return;
    supabase.rpc('my_feed').then(({ data, error }) => {
      if (error) return;
      setFeed(data || []);
      if ((data || []).length && markRead) setTimeout(markRead, 1500);
    });
  }, [uid, stamp]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!feed.length) return null;
  return (
    <section className="stack-sm">
      <h2 className="feed-head">From shops you follow</h2>
      <ul className="feed-list">
        {feed.slice(0, 6).map((n) => {
          const pics = (n.products || []).filter((p) => p.photo_path).slice(0, 3);
          return (
            <li key={n.id}>
              <a className="feed-card" href={'/' + n.shop.slug}>
                {pics.length > 0 && (
                  <span className={'feed-pics n' + pics.length} aria-hidden="true">
                    {pics.map((p) => (
                      <img key={p.id} src={photoUrl(p.photo_path)} alt="" loading="lazy" />
                    ))}
                  </span>
                )}
                <span className="feed-in">
                  <span className="feed-top">
                    <b>{n.shop.name}</b>
                    <span className="sub">{agoText(n.at)}</span>
                    <span className={'feed-tag ' + n.kind}>{TAG[n.kind]}</span>
                  </span>
                  <strong>{n.line}</strong>
                  {n.body && <span className="sub">{n.body}</span>}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
