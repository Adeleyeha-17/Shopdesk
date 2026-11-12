// Rating the shop, on a delivered order's page. One rating per customer per shop: rating again (after another order)
// changes it. Everyone can see the stars and comment, with the customer's first name and initial.
// A delivered order opened unrated opens the rating sheet by itself, until they post or close it once.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/database.js';
import { errText } from '../lib/helpers.js';
import { Stars } from './NearYou.jsx';

const WORDS = ['', 'Poor', 'Not great', 'Okay', 'Good', 'Loved it'];
const STAR = 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.6l1-5.8-4.3-4.1 5.9-.9z';
const ASKED = 'shopdesk-rate-asked';
function asked(token) {
  try {
    return JSON.parse(localStorage.getItem(ASKED) || '[]').includes(token);
  } catch (e) {
    return true;
  }
}
function markAsked(token) {
  try {
    const l = JSON.parse(localStorage.getItem(ASKED) || '[]');
    localStorage.setItem(ASKED, JSON.stringify([token, ...l].slice(0, 50)));
  } catch (e) {
    /* private browsing */
  }
}

function StarPicker({ value, onPick, big }) {
  return (
    <div className={'star-pick' + (big ? ' big' : '')} role="radiogroup" aria-label="Your rating">
      {[1, 2, 3, 4, 5].map((k) => (
        <button
          key={k}
          type="button"
          role="radio"
          aria-checked={value === k}
          aria-label={`${k} star${k === 1 ? '' : 's'}: ${WORDS[k]}`}
          className={k <= value ? 'on' : ''}
          onClick={() => onPick(k)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d={STAR} />
          </svg>
        </button>
      ))}
    </div>
  );
}

function RateSheet({ shopName, start, onClose, onSaved, token }) {
  const [stars, setStars] = useState(start.stars || 0);
  const [text, setText] = useState(start.comment || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [closing, setClosing] = useState(false);
  const leaving = useRef(false);
  const close = useCallback(() => {
    if (leaving.current) return;
    leaving.current = true;
    setClosing(true);
    setTimeout(onClose, 200);
  }, [onClose]);
  useEffect(() => {
    const key = (e) => e.key === 'Escape' && close();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [close]);
  async function post() {
    if (!stars) {
      setErr('Tap the stars to rate.');
      return;
    }
    setBusy(true);
    setErr('');
    const { data, error } = await supabase.rpc('rate_shop', { p_token: token, p_stars: stars, p_comment: text });
    setBusy(false);
    if (error) {
      setErr(errText(error));
      return;
    }
    onSaved({ stars: data.stars, comment: data.comment });
    close();
  }
  return (
    <div
      className={'overlay bottom' + (closing ? ' closing' : '')}
      onClick={(e) => e.target === e.currentTarget && close()}
    >
      <div className="modal sheet rate-sheet" role="dialog" aria-modal="true" aria-labelledby="rateTitle">
        <div className="rate-sheet-head">
          <h2 id="rateTitle">How was {shopName}?</h2>
          <span className="sub">Your order was delivered.</span>
        </div>
        <div className="rate-stars">
          <StarPicker value={stars} onPick={setStars} big />
          <span className="rate-word">{stars ? WORDS[stars] : 'Tap to rate'}</span>
        </div>
        <div className="field">
          <label htmlFor="rateText">Tell other customers what it was like</label>
          <textarea
            id="rateText"
            rows={3}
            maxLength={400}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Optional: packaging, delivery, how they answered…"
          />
        </div>
        <p className="note small">Everyone can see your stars and comment, with your first name.</p>
        {err && (
          <p className="err" role="alert">
            {err}
          </p>
        )}
        <button className="btn" onClick={post} disabled={busy}>
          {busy ? 'Posting…' : start.stars ? 'Save rating' : 'Post rating'}
        </button>
        <button className="linkbtn rate-later" onClick={close}>
          Not now
        </button>
      </div>
    </div>
  );
}

export function RateShop({ token, shopName, slug }) {
  const [mine, setMine] = useState(undefined); // undefined: loading or not theirs; null: not rated; { stars, comment }
  const [ok, setOk] = useState(false);
  const [sheet, setSheet] = useState(null); // { stars, comment } to start the sheet with
  useEffect(() => {
    supabase.rpc('my_shop_rating', { p_token: token }).then(({ data, error }) => {
      if (error) return;
      setOk(true);
      setMine(data || null);
      if (!data && !asked(token)) setSheet({});
    });
  }, [token]);
  if (!ok || mine === undefined) return null;
  return (
    <>
      <section className="card boxed rate-card">
        {mine ? (
          <>
            <div className="row">
              <strong>You rated {shopName}</strong>
              <button className="linkbtn" onClick={() => setSheet(mine)}>
                Change
              </button>
            </div>
            <Stars n={mine.stars} size={18} />
            {mine.comment && <p className="rate-quote">“{mine.comment}”</p>}
            <a className="linkbtn" href={'/' + slug + '/ratings'}>
              See all ratings
            </a>
          </>
        ) : (
          <>
            <strong>How was {shopName}?</strong>
            <span className="sub">Your rating helps other customers choose.</span>
            <StarPicker value={0} onPick={(k) => setSheet({ stars: k })} />
          </>
        )}
      </section>
      {sheet && (
        <RateSheet
          token={token}
          shopName={shopName}
          start={sheet}
          onClose={() => {
            markAsked(token);
            setSheet(null);
          }}
          onSaved={(r) => setMine(r)}
        />
      )}
    </>
  );
}
