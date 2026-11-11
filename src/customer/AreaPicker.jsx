// The area picker at checkout: a bottom sheet with a search box, Lagos areas, other cities, and "Somewhere else".
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LAGOS, CITIES } from './areas.js';

export function AreaPicker({ value, onPick, onClose }) {
  const [q, setQ] = useState('');
  const [other, setOther] = useState('');
  const [typing, setTyping] = useState(false);
  const box = useRef(null);
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
  const words = q.trim().toLowerCase();
  const match = (a) => !words || a.toLowerCase().includes(words);
  const lagos = LAGOS.filter(match);
  const cities = CITIES.filter(match);
  const choose = (a) => {
    onPick(a);
    close();
  };
  const row = (a) => (
    <li key={a}>
      <button className={'area-row' + (value === a ? ' on' : '')} onClick={() => choose(a)}>
        {a}
        {value === a && <span aria-hidden="true">✓</span>}
      </button>
    </li>
  );
  return (
    <div
      className={'overlay bottom' + (closing ? ' closing' : '')}
      onClick={(e) => e.target === e.currentTarget && close()}
    >
      <div className="modal sheet area-sheet" role="dialog" aria-modal="true" aria-labelledby="areaTitle">
        <div className="row">
          <h2 id="areaTitle" className="sheet-title">
            Your area
          </h2>
          <button className="linkbtn" onClick={close}>
            Cancel
          </button>
        </div>
        <div className="search">
          <input
            ref={box}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search: Lekki, Yaba, Abuja…"
            aria-label="Search areas"
            autoComplete="off"
          />
        </div>
        <div className="area-list">
          {lagos.length > 0 && (
            <>
              <div className="label">Lagos</div>
              <ul>{lagos.map(row)}</ul>
            </>
          )}
          {cities.length > 0 && (
            <>
              <div className="label">Other cities</div>
              <ul>{cities.map(row)}</ul>
            </>
          )}
          <div className="label">Not listed?</div>
          {typing ? (
            <div className="area-other">
              <input
                autoFocus
                value={other}
                onChange={(e) => setOther(e.target.value.slice(0, 40))}
                placeholder="Type your area or town"
                aria-label="Your area or town"
              />
              <button
                className="btn small"
                disabled={other.trim().length < 2}
                onClick={() => choose(other.trim())}
              >
                Use this
              </button>
            </div>
          ) : (
            <button className="area-row" onClick={() => (setTyping(true), setOther(q.trim()))}>
              Somewhere else…
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
