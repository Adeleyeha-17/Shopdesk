// Shops near you: every shop taking orders, the ones in the customer's area first, then the rest of their city,
// then everywhere else; best rated first. The area comes from their account, or what they picked on this phone.
// A shop's area is read from where it says it's based ("Yaba, Lagos" -> Yaba).
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/database.js';
import { photoUrl } from '../lib/photos.js';
import { AreaPicker } from './AreaPicker.jsx';
import { LAGOS, areaIn } from './areas.js';

const KEY = 'shopdesk-area';
export function savedArea() {
  try {
    return localStorage.getItem(KEY) || '';
  } catch (e) {
    return '';
  }
}
export function saveArea(a) {
  try {
    localStorage.setItem(KEY, a);
  } catch (e) {
    /* private browsing */
  }
}

const STAR = 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.6l1-5.8-4.3-4.1 5.9-.9z';
export const Star = () => (
  <svg className="star" viewBox="0 0 24 24" aria-hidden="true">
    <path d={STAR} />
  </svg>
);
export function Stars({ n, size }) {
  return (
    <span className="stars" style={size ? { '--star': size + 'px' } : undefined} aria-label={`${n} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((k) => (
        <svg key={k} viewBox="0 0 24 24" className={k <= Math.round(n) ? '' : 'off'} aria-hidden="true">
          <path d={STAR} />
        </svg>
      ))}
    </span>
  );
}
export const PinIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z" />
    <circle cx="12" cy="9.5" r="2.5" />
  </svg>
);
const inLagos = (s) => LAGOS.includes(s.area) || /lagos/i.test(s.location || '');

// skip: shops already on their list above, so a shop isn't shown twice. title: the heading (h1 when it's the whole page).
export function NearYou({ skip = [], heading = 'h2', uid = null }) {
  const [shops, setShops] = useState(null);
  const [err, setErr] = useState(false);
  const [area, setArea] = useState(savedArea);
  const [picking, setPicking] = useState(false);
  const [find, setFind] = useState('');
  useEffect(() => {
    supabase.rpc('shops_near').then(({ data, error }) => {
      if (error) setErr(true);
      else setShops((data || []).map((s) => ({ ...s, area: areaIn(s.location) })));
    });
  }, []);
  // signed in: their saved area wins
  useEffect(() => {
    if (!uid) return;
    supabase
      .from('customers')
      .select('area')
      .maybeSingle()
      .then(({ data }) => {
        if (data && data.area) {
          setArea(data.area);
          saveArea(data.area);
        }
      });
  }, [uid]);
  function pick(a) {
    setArea(a);
    saveArea(a);
    if (uid)
      supabase
        .from('customers')
        .update({ area: a, updated_at: new Date().toISOString() })
        .eq('user_id', uid)
        .then(() => {});
  }
  const groups = useMemo(() => {
    if (!shops) return [];
    const words = find.trim().toLowerCase();
    const list = shops
      .filter((s) => !skip.includes(s.slug))
      .filter((s) => !words || (s.name + ' ' + s.sells + ' ' + s.location).toLowerCase().includes(words))
      .sort((a, b) => (b.ratings ? 1 : 0) - (a.ratings ? 1 : 0) || (b.rating || 0) - (a.rating || 0) || b.ratings - a.ratings);
    if (!area) return [['All shops', list]];
    const here = list.filter((s) => s.area === area);
    const city = LAGOS.includes(area) ? list.filter((s) => s.area !== area && inLagos(s)) : [];
    const rest = list.filter((s) => !here.includes(s) && !city.includes(s));
    return [
      [`In ${area}`, here],
      ['Elsewhere in Lagos', city],
      [here.length || city.length ? 'Other places' : 'Shops on ShopDesk', rest],
    ].filter(([, l]) => l.length);
  }, [shops, area, find, skip]);
  const H = heading;
  return (
    <section className="near" aria-labelledby="nearTitle">
      <div className="near-head">
        <H id="nearTitle">Shops near you</H>
        <button type="button" className="area-chip" onClick={() => setPicking(true)}>
          <PinIcon />
          <span>{area || 'Pick your area'}</span>
          <svg className="down" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </div>
      {shops && shops.length > 4 && (
        <div className="search">
          <label htmlFor="findNear" className="visually-hidden">
            Search shops
          </label>
          <input
            id="findNear"
            type="search"
            value={find}
            onChange={(e) => setFind(e.target.value)}
            placeholder="Search shops or what they sell"
            autoComplete="off"
          />
        </div>
      )}
      {err && <p className="note">Couldn't load the shops. Check your connection and open this page again.</p>}
      {!shops && !err && (
        <ul className="near-list" aria-hidden="true">
          {[0, 1, 2].map((k) => (
            <li key={k} className="near-shop ghost" />
          ))}
        </ul>
      )}
      {shops && !groups.length && (
        <p className="note">{find.trim() ? `No shop matches “${find.trim()}”.` : 'No shops here yet.'}</p>
      )}
      {groups.map(([title, list]) => (
        <div className="near-group" key={title}>
          <h3 className="eyebrow-title">{title}</h3>
          <ul className="near-list">
            {list.map((s) => (
              <li key={s.slug}>
                <a className="near-shop" href={'/' + s.slug}>
                  <span className={'near-pic' + (s.photo_path ? '' : ' letter')} aria-hidden="true">
                    {s.photo_path ? (
                      <img src={photoUrl(s.photo_path)} alt="" loading="lazy" />
                    ) : (
                      (s.name.trim()[0] || '?').toUpperCase()
                    )}
                  </span>
                  <span className="near-info">
                    <strong>{s.name}</strong>
                    {s.sells && <span className="near-sells">{s.sells}</span>}
                    <span className="near-meta">
                      {s.ratings ? (
                        <>
                          <Star />
                          <b>{Number(s.rating).toFixed(1)}</b>
                          <span className="sub">({s.ratings})</span>
                        </>
                      ) : (
                        <span className="near-new">New</span>
                      )}
                      {(s.area || s.location) && (
                        <>
                          <span className="dotsep" aria-hidden="true">
                            ·
                          </span>
                          <span className="sub">{s.area || s.location}</span>
                        </>
                      )}
                    </span>
                  </span>
                  <svg className="chev" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M9 5l7 7-7 7" />
                  </svg>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {picking && <AreaPicker value={area} onPick={pick} onClose={() => setPicking(false)} />}
    </section>
  );
}
