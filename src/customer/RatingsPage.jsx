// /<shop>/ratings: what customers say about a shop. Anyone can read it. Each customer has one rating per shop,
// given after a delivered order; names show as first name and initial.
import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/database.js';
import { DAY, dayOf, startOfDay } from '../lib/dates.js';
import { useBusy } from '../lib/busy.js';
import { Page } from '../shared/Page.jsx';
import { LoadError } from '../shared/LoadError.jsx';
import { Skeleton } from '../shared/Skeleton.jsx';
import { Stars } from './NearYou.jsx';

function ago(at) {
  const days = Math.round((startOfDay(Date.now()) - startOfDay(at)) / DAY);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return '1 week ago';
  if (days < 31) return `${Math.floor(days / 7)} weeks ago`;
  return dayOf(at);
}

export function RatingsPage({ slug }) {
  const [d, setD] = useState(undefined);
  const [err, setErr] = useState(null);
  const load = () =>
    supabase.rpc('shop_reviews', { p_slug: slug }).then(({ data, error }) => {
      if (error) setErr(error);
      else {
        setErr(null);
        setD(data || null);
      }
    });
  useEffect(() => {
    load();
  }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps
  useBusy(d === undefined && !err);
  const back = '/' + slug;
  if (err && d === undefined)
    return (
      <Page back={back}>
        <LoadError error={err} onRetry={load} what="the ratings" />
      </Page>
    );
  if (d === undefined)
    return (
      <Page back={back}>
        <Skeleton kind="list" />
      </Page>
    );
  if (!d)
    return (
      <Page back={back}>
        <div className="center">
          <h2>This shop isn't on ShopDesk</h2>
          <p className="note">Check the link with the shop.</p>
        </div>
      </Page>
    );
  const total = d.ratings || 0;
  return (
    <Page title={d.name} titleHref={back} back={back}>
      <div className="page-title">
        <h1>Ratings</h1>
        <p>From customers whose orders were delivered. One rating each.</p>
      </div>
      {total === 0 ? (
        <section className="card boxed">
          <p className="note">No ratings yet. Customers can rate {d.name} once their order is delivered.</p>
        </section>
      ) : (
        <>
          <section className="card boxed rate-sum">
            <div className="rate-big">
              <b>{Number(d.rating).toFixed(1)}</b>
              <Stars n={d.rating} />
              <span className="sub">
                {total} rating{total === 1 ? '' : 's'}
              </span>
            </div>
            <div className="rate-bars">
              {[5, 4, 3, 2, 1].map((k) => {
                const c = (d.stars && d.stars[k]) || 0;
                return (
                  <div className="rate-bar" key={k}>
                    <span>{k}</span>
                    <i style={{ '--w': (c / total) * 100 + '%' }} />
                    <span>{c}</span>
                  </div>
                );
              })}
            </div>
          </section>
          <section className="stack-sm">
            <h2 className="eyebrow-title">What customers say</h2>
            <ul className="reviews">
              {d.reviews.map((r, i) => (
                <li key={i} className="review">
                  <div className="review-who">
                    <span className="review-av" aria-hidden="true">
                      {(r.who || '?')[0].toUpperCase()}
                    </span>
                    <div>
                      <strong>{r.who}</strong>
                      <span className="review-when">
                        <Stars n={r.stars} size={12} />
                        {ago(r.at)}
                      </span>
                    </div>
                  </div>
                  {r.comment && <p>{r.comment}</p>}
                  {r.bought && <span className="review-bought">Bought {r.bought}</span>}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </Page>
  );
}
