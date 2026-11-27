// Shop tab > Sales and discount codes: a one-line sale banner at the top of the shop's page, and discount codes customers
// type at checkout (% off or ₦ off, with an optional minimum order, end date and number of uses). The database checks
// every code again when an order is placed.
import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/database.js';
import { naira } from '../lib/money.js';
import { errText } from '../lib/helpers.js';

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
const dayText = (d) =>
  new Date(d + 'T12:00:00').toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short' });
const offText = (c) => (c.kind === 'percent' ? `${c.value}% off` : `${naira(c.value)} off`);

const TAG = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 12l9-9h8v8l-9 9zM15.5 8.5h.01" />
  </svg>
);

function Banner({ shop, reloadShop, say }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(shop.banner || '');
  const [until, setUntil] = useState(shop.banner_until || '');
  const [busy, setBusy] = useState(false);
  const showing = !!shop.banner && (!shop.banner_until || shop.banner_until >= today());
  async function save(clear) {
    const patch = clear ? { banner: '', banner_until: null } : { banner: text.trim(), banner_until: until || null };
    if (!clear && patch.banner.length < 3) {
      say('Write the banner first.');
      return;
    }
    if (!clear && until && until < today()) {
      say('Pick a date from today on.');
      return;
    }
    setBusy(true);
    const { error } = await supabase.from('shops').update(patch).eq('id', shop.id);
    setBusy(false);
    if (error) say(errText(error));
    else {
      if (clear) {
        setText('');
        setUntil('');
      }
      setEditing(false);
      say(clear ? 'Banner removed.' : 'Banner saved.');
      reloadShop();
    }
  }
  if (!editing)
    return (
      <div className="promo-block">
        <div className="promo-head">
          <div>
            <p className="promo-title">Sale banner</p>
            <p className="sub">
              {!shop.banner
                ? 'One line at the top of your shop page.'
                : showing
                  ? shop.banner_until
                    ? `Showing until ${dayText(shop.banner_until)}`
                    : 'Showing now'
                  : 'Ended. Edit it to show it again.'}
            </p>
          </div>
          <button className="btn small ghost" onClick={() => setEditing(true)}>
            {shop.banner ? 'Edit' : 'Add'}
          </button>
        </div>
        {shop.banner && (
          <div className={'sale-banner' + (showing ? '' : ' off')}>
            {TAG}
            <span>{shop.banner}</span>
          </div>
        )}
      </div>
    );
  return (
    <div className="promo-block">
      <p className="promo-title">Sale banner</p>
      <div className="promo-form">
        <div className="field">
          <label htmlFor="bnText">Banner</label>
          <input
            id="bnText"
            value={text}
            maxLength={80}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. Black Friday: 20% off with code BF20"
            autoFocus
          />
        </div>
        <div className="field">
          <label htmlFor="bnUntil">Show until (optional)</label>
          <input id="bnUntil" type="date" value={until} min={today()} onChange={(e) => setUntil(e.target.value)} />
        </div>
        {text.trim() && (
          <div className="sale-banner" aria-hidden="true">
            {TAG}
            <span>{text.trim()}</span>
          </div>
        )}
        <div className="btns">
          <button className="btn small" onClick={() => save(false)} disabled={busy}>
            Save
          </button>
          <button className="btn small ghost" onClick={() => setEditing(false)} disabled={busy}>
            Cancel
          </button>
          {shop.banner && (
            <button className="linkbtn bad promo-remove" onClick={() => save(true)} disabled={busy}>
              Remove
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const EMPTY = { code: '', kind: 'percent', value: '', min: '', ends: '', max: '' };

function NewCode({ onDone, say }) {
  const [f, setF] = useState(EMPTY);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const num = (x) => (String(x).trim() === '' ? null : Math.round(Number(String(x).replace(/[^\d.]/g, ''))));
  async function save() {
    setBusy(true);
    setErr('');
    const { error } = await supabase.rpc('save_coupon', {
      p_id: null,
      p_code: f.code,
      p_kind: f.kind,
      p_value: num(f.value),
      p_min: num(f.min) || 0,
      p_ends: f.ends || null,
      p_max: num(f.max),
      p_active: true,
    });
    setBusy(false);
    if (error) setErr(errText(error));
    else {
      say(`Code ${f.code.replace(/\s/g, '').toUpperCase()} is ready. Share it with your customers.`);
      onDone();
    }
  }
  return (
    <div className="promo-form">
      <div className="field">
        <label htmlFor="cpCode">Code</label>
        <input
          id="cpCode"
          value={f.code}
          maxLength={20}
          autoCapitalize="characters"
          onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase().replace(/\s/g, '') })}
          placeholder="e.g. BF20"
        />
      </div>
      <div className="seg wide" role="group" aria-label="Discount type">
        <button aria-pressed={f.kind === 'percent'} onClick={() => setF({ ...f, kind: 'percent' })}>
          % off
        </button>
        <button aria-pressed={f.kind === 'amount'} onClick={() => setF({ ...f, kind: 'amount' })}>
          ₦ off
        </button>
      </div>
      <div className="field">
        <label htmlFor="cpValue">{f.kind === 'percent' ? 'Percentage off (1 to 90)' : 'Amount off (₦)'}</label>
        <input id="cpValue" inputMode="numeric" value={f.value} onChange={set('value')} placeholder={f.kind === 'percent' ? 'e.g. 10' : 'e.g. 2000'} />
      </div>
      <div className="field">
        <label htmlFor="cpMin">Minimum order (₦, optional)</label>
        <input id="cpMin" inputMode="numeric" value={f.min} onChange={set('min')} placeholder="No minimum" />
      </div>
      <div className="promo-two">
        <div className="field">
          <label htmlFor="cpEnds">Ends (optional)</label>
          <input id="cpEnds" type="date" value={f.ends} min={today()} onChange={set('ends')} />
        </div>
        <div className="field">
          <label htmlFor="cpMax">Uses (optional)</label>
          <input id="cpMax" inputMode="numeric" value={f.max} onChange={set('max')} placeholder="No limit" />
        </div>
      </div>
      <p className="note">Each customer can use a code once.</p>
      {err && <p className="err">{err}</p>}
      <div className="btns">
        <button className="btn small" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save code'}
        </button>
        <button className="btn small ghost" onClick={onDone} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function Codes({ say }) {
  const [list, setList] = useState(null);
  const [adding, setAdding] = useState(false);
  const load = useCallback(
    () => supabase.rpc('shop_coupons').then(({ data, error }) => setList(error ? [] : data || [])),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);
  async function toggle(c) {
    const { error } = await supabase.rpc('save_coupon', {
      p_id: c.id,
      p_code: c.code,
      p_kind: c.kind,
      p_value: c.value,
      p_min: c.min_total,
      p_ends: c.ends_on && c.ends_on >= today() ? c.ends_on : null,
      p_max: c.max_uses,
      p_active: !c.active,
    });
    if (error) say(errText(error));
    else {
      say(c.active ? `${c.code} is off.` : `${c.code} is on again.`);
      load();
    }
  }
  async function remove(c) {
    const { error } = await supabase.rpc('delete_coupon', { p_id: c.id });
    if (error) say(errText(error));
    else {
      say(`${c.code} deleted.`);
      load();
    }
  }
  return (
    <div className="promo-block">
      <div className="promo-head">
        <div>
          <p className="promo-title">Discount codes</p>
          <p className="sub">Customers type the code at checkout.</p>
        </div>
        {!adding && (
          <button className="btn small ghost" onClick={() => setAdding(true)}>
            New code
          </button>
        )}
      </div>
      {adding && (
        <NewCode
          say={say}
          onDone={() => {
            setAdding(false);
            load();
          }}
        />
      )}
      {list === null ? (
        <p className="sub">Loading…</p>
      ) : list.length === 0 ? (
        !adding && <p className="sub promo-empty">No codes yet. Make one and post it on your status or Instagram.</p>
      ) : (
        <ul className="promo-codes">
          {list.map((c) => {
            const live = c.active && !c.ended && !(c.max_uses && c.uses >= c.max_uses);
            return (
              <li key={c.id}>
                <div className="promo-code-top">
                  <strong className="mono">{c.code}</strong>
                  <span className={'promo-state' + (live ? ' on' : '')}>
                    {live ? 'On' : c.ended ? 'Ended' : c.active ? 'Used up' : 'Off'}
                  </span>
                </div>
                <span className="promo-what">
                  {offText(c)}
                  {c.min_total > 0 ? ` · ${naira(c.min_total)}+ orders` : ''}
                  {c.ends_on ? ` · ends ${dayText(c.ends_on)}` : ''}
                </span>
                <div className="promo-foot">
                  <span className="sub">
                    Used {c.uses}
                    {c.max_uses ? `/${c.max_uses}` : ''}
                    {c.off > 0 ? ` · ${naira(c.off)} off` : ''}
                  </span>
                  <span className="promo-acts">
                    {!c.ended && (
                      <button className="linkbtn" onClick={() => toggle(c)}>
                        {c.active ? 'Switch off' : 'Switch on'}
                      </button>
                    )}
                    <button className="linkbtn bad" onClick={() => remove(c)}>
                      Delete
                    </button>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function Promotions({ shop, reloadShop, say }) {
  return (
    <section className="card promos">
      <h2>Sales and discount codes</h2>
      <Banner shop={shop} reloadShop={reloadShop} say={say} />
      <Codes say={say} />
    </section>
  );
}
