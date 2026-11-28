// Shop tab > Announcements: tell your customers about a new product, a sale, Black Friday or a restock. It reaches
// everyone who follows the shop and everyone who has ordered from it (unless they unfollowed), as a phone alert, on the
// shop's page and in their Shops tab. One a day. ShopDesk makes a poster for WhatsApp status and Instagram from it.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/database.js';
import { photoUrl } from '../lib/photos.js';
import { errText } from '../lib/helpers.js';
import { makePoster, sharePoster, savePoster } from '../shared/poster.js';
import { HANDOFF } from './SlowSales.jsx';

const KINDS = [
  ['new', 'New product'],
  ['sale', 'Sale'],
  ['black_friday', 'Black Friday'],
  ['restock', 'Back in stock'],
];
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
const agoText = (at) => {
  const d = Math.floor((Date.now() - new Date(at).getTime()) / 864e5);
  return d <= 0 ? 'Today' : d === 1 ? 'Yesterday' : `${d} days ago`;
};

function Poster({ shop, news, say, onDone }) {
  const [blob, setBlob] = useState(null);
  const [url, setUrl] = useState('');
  useEffect(() => {
    let on = true;
    let u = '';
    makePoster(shop, news).then((b) => {
      if (!on || !b) return;
      u = URL.createObjectURL(b);
      setBlob(b);
      setUrl(u);
    });
    return () => {
      on = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [shop, news]);
  return (
    <div className="news-poster">
      {url ? <img src={url} alt={`Poster: ${news.line}`} /> : <div className="news-poster-wait" />}
      <div className="news-two">
        <button
          className="btn"
          disabled={!blob}
          onClick={async () => {
            const r = await sharePoster(blob, shop, `${news.line} shopdesk.com.ng/${shop.slug}`);
            if (r === 'saved') say('Poster saved. Post it on your status.');
          }}
        >
          Share poster
        </button>
        <button className="btn ghost" disabled={!blob} onClick={() => savePoster(blob, shop)}>
          Download
        </button>
      </div>
      {onDone && (
        <button className="linkbtn news-done" onClick={onDone}>
          Done
        </button>
      )}
    </div>
  );
}

// a quick sale from the Sales tab opens the form ready: Sale, its code and end date, the newest products picked
function takeHandoff() {
  try {
    const h = JSON.parse(sessionStorage.getItem(HANDOFF) || 'null');
    sessionStorage.removeItem(HANDOFF);
    return h && h.kind ? h : null;
  } catch (e) {
    return null;
  }
}

function NewsForm({ shop, products, audience, preset, say, onPosted, onCancel }) {
  const live = products.filter((p) => p.active !== false);
  const [kind, setKind] = useState((preset && preset.kind) || 'new');
  const [picked, setPicked] = useState(() =>
    preset ? live.filter((p) => p.photo_path && p.stock > 0).slice(0, 3).map((p) => p.id) : [],
  );
  const [codes, setCodes] = useState([]);
  const [coupon, setCoupon] = useState(preset && preset.coupon ? String(preset.coupon) : '');
  const [body, setBody] = useState('');
  const [ends, setEnds] = useState((preset && preset.ends) || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    supabase.rpc('shop_coupons').then(({ data }) =>
      setCodes((data || []).filter((c) => c.active && !c.ended && !(c.max_uses && c.uses >= c.max_uses))),
    );
  }, []);
  const toggle = (id) =>
    setPicked((x) => (x.includes(id) ? x.filter((y) => y !== id) : x.length >= 6 ? x : [...x, id]));
  async function post() {
    setBusy(true);
    setErr('');
    const { data, error } = await supabase.rpc('post_news', {
      p_kind: kind,
      p_body: body,
      p_products: picked,
      p_coupon: coupon ? Number(coupon) : null,
      p_ends: ends || null,
    });
    setBusy(false);
    if (error) setErr(errText(error));
    else {
      say(data.sent ? `Sent to ${data.sent} customer${data.sent === 1 ? '' : 's'}.` : 'Posted on your shop page.');
      onPosted(data);
    }
  }
  return (
    <div className="promo-form news-form">
      <div className="choices tiles" role="radiogroup" aria-label="What's new?">
        {KINDS.map(([k, label]) => (
          <button key={k} type="button" className="choice" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}>
            <strong>{label}</strong>
            <i aria-hidden="true" />
          </button>
        ))}
      </div>
      <div className="field">
        <span className="label">Products {picked.length > 0 && <span className="sub">· {picked.length} picked</span>}</span>
        <div className="news-picks">
          {live.map((p) => (
            <button
              key={p.id}
              type="button"
              className="news-pick"
              aria-pressed={picked.includes(p.id)}
              onClick={() => toggle(p.id)}
              title={p.name}
            >
              {p.photo_path ? <img src={photoUrl(p.photo_path)} alt="" /> : <span>{p.name[0]}</span>}
              <i aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              </i>
              <span className="visually-hidden">{p.name}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label htmlFor="newsCode">Discount code (optional)</label>
        <select id="newsCode" value={coupon} onChange={(e) => setCoupon(e.target.value)}>
          <option value="">None</option>
          {codes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code} · {c.kind === 'percent' ? `${c.value}% off` : `₦${Number(c.value).toLocaleString()} off`}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="newsBody">Message (optional)</label>
        <textarea
          id="newsBody"
          rows={2}
          maxLength={200}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="e.g. This weekend only."
        />
      </div>
      <div className="field">
        <label htmlFor="newsEnds">Ends (optional)</label>
        <input id="newsEnds" type="date" value={ends} min={today()} onChange={(e) => setEnds(e.target.value)} />
      </div>
      {err && <p className="err">{err}</p>}
      <div className="btns">
        <button className="btn" onClick={post} disabled={busy || !picked.length}>
          {busy ? 'Sending…' : audience > 0 ? `Announce to ${audience} customer${audience === 1 ? '' : 's'}` : 'Announce'}
        </button>
        <button className="btn ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function Announce({ shop, products, say }) {
  const [d, setD] = useState(null);
  const [preset] = useState(takeHandoff);
  const [mode, setMode] = useState(preset ? 'new' : ''); // '' | 'new' | poster for an announcement id
  const [just, setJust] = useState(null);
  const box = useRef(null);
  const opened = useRef(false);
  const load = useCallback(
    () => supabase.rpc('my_news').then(({ data, error }) => setD(error || !data ? { audience: 0, list: [] } : data)),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (!preset || !d || opened.current) return;
    opened.current = true;
    if (d.posted_today) setMode('');
    if (box.current) box.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [preset, d]);
  if (!d) return null;
  const list = d.list || [];
  const shown = just || (typeof mode === 'number' ? list.find((n) => n.id === mode) : null);
  return (
    <section className="card news-card" ref={box}>
      <div className="promo-head">
        <div>
          <h2>Announcements</h2>
          <p className="sub">
            {d.audience} customer{d.audience === 1 ? '' : 's'} hear{d.audience === 1 ? 's' : ''} your news
          </p>
        </div>
        {!mode && !just && (
          <button className="btn small ghost" onClick={() => setMode('new')} disabled={d.posted_today || shop.status !== 'active'}>
            {d.posted_today ? 'Next one tomorrow' : 'New'}
          </button>
        )}
      </div>
      {mode === 'new' && !just && (
        <NewsForm
          shop={shop}
          products={products}
          audience={d.audience}
          preset={preset}
          say={say}
          onCancel={() => setMode('')}
          onPosted={(n) => {
            setJust(n);
            load();
          }}
        />
      )}
      {shown && (
        <Poster
          shop={shop}
          news={shown}
          say={say}
          onDone={() => {
            setJust(null);
            setMode('');
          }}
        />
      )}
      {!mode && !just && list.length > 0 && (
        <ul className="news-list">
          {list.slice(0, 5).map((n) => (
            <li key={n.id}>
              <span className="news-line">{n.line}</span>
              <span className="news-foot">
                <span className="sub">
                  {agoText(n.at)} · sent to {n.sent}
                </span>
                <button className="linkbtn" onClick={() => setMode(n.id)}>
                  Poster
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
