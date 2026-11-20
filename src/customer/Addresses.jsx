// A customer's delivery addresses (home, office...). Account lists them, with Add and Remove; at checkout, Change opens
// the list to pick from, or to type a new one. An address used at checkout is saved when the order is placed.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/database.js';
import { errText } from '../lib/helpers.js';
import { AreaPicker } from './AreaPicker.jsx';
import { areaIn } from './areas.js';
import { PinIcon } from './NearYou.jsx';

// the customer's addresses, used last first
export async function loadAddresses() {
  const { data, error } = await supabase
    .from('customer_addresses')
    .select('id, address, area, used_at')
    .order('used_at', { ascending: false });
  return error ? [] : data || [];
}

export function AccountAddresses({ userId }) {
  const [list, setList] = useState(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ address: '', area: '' });
  const [areaOpen, setAreaOpen] = useState(false);
  const [msg, setMsg] = useState('');
  const reload = useCallback(() => loadAddresses().then(setList), []);
  useEffect(() => {
    reload();
  }, [reload]);
  async function add() {
    const address = draft.address.trim().slice(0, 160);
    if (address.length < 3) return setMsg('Type the address: house number, street and area.');
    const { error } = await supabase
      .from('customer_addresses')
      .insert({ user_id: userId, address, area: (draft.area || areaIn(address) || '').slice(0, 40) });
    if (error) return setMsg(/duplicate|unique/i.test(error.message) ? 'You saved this address already.' : errText(error));
    setMsg('');
    setAdding(false);
    setDraft({ address: '', area: '' });
    reload();
  }
  async function remove(id) {
    const { error } = await supabase.from('customer_addresses').delete().eq('id', id);
    if (error) setMsg(errText(error));
    else reload();
  }
  return (
    <section className="card" aria-label="Addresses">
      <div className="row">
        <h2>Addresses</h2>
        {!adding && (
          <button className="btn small ghost" onClick={() => setAdding(true)}>
            Add
          </button>
        )}
      </div>
      {msg && <p className="note">{msg}</p>}
      {list && list.length > 0 && (
        <ul className="addr-list">
          {list.map((a, i) => (
            <li key={a.id}>
              <span className="co-pin" aria-hidden="true">
                <PinIcon />
              </span>
              <div>
                <strong>{a.address}</strong>
                <span className="sub">
                  {[a.area, i === 0 ? 'Used last' : ''].filter(Boolean).join(' · ')}
                </span>
              </div>
              <button className="linkbtn" onClick={() => remove(a.id)} aria-label={'Remove ' + a.address}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {list && !list.length && !adding && <p className="sub">Addresses you deliver to are saved here when you order.</p>}
      {adding && (
        <div className="stack-sm">
          <div className="field">
            <label htmlFor="newAddr">New address</label>
            <input
              id="newAddr"
              autoComplete="street-address"
              value={draft.address}
              onChange={(e) => setDraft({ ...draft, address: e.target.value })}
              placeholder="House number, street and area"
              autoFocus
            />
            <span className="area-line">
              {draft.area || areaIn(draft.address) ? (
                <>
                  Area: <strong>{draft.area || areaIn(draft.address)}</strong>
                </>
              ) : (
                'Add the area so shops know where it is.'
              )}{' '}
              <button className="linkbtn" onClick={() => setAreaOpen(true)}>
                {draft.area || areaIn(draft.address) ? 'Change' : 'Pick area'}
              </button>
            </span>
          </div>
          <div className="btns">
            <button className="btn small" onClick={add}>
              Save address
            </button>
            <button
              className="linkbtn"
              onClick={() => {
                setAdding(false);
                setMsg('');
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {areaOpen && (
        <AreaPicker
          value={draft.area}
          onPick={(a) => setDraft((d) => ({ ...d, area: a }))}
          onClose={() => setAreaOpen(false)}
        />
      )}
    </section>
  );
}

// Checkout: pick one of the saved addresses, or type a new one.
export function AddressSheet({ list, current, onPick, onNew, onClose }) {
  const [closing, setClosing] = useState(false);
  const leaving = useRef(false);
  const close = useCallback(
    (then) => {
      if (leaving.current) return;
      leaving.current = true;
      setClosing(true);
      setTimeout(() => {
        onClose();
        if (then) then();
      }, 200);
    },
    [onClose],
  );
  useEffect(() => {
    const key = (e) => e.key === 'Escape' && close();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [close]);
  return (
    <div
      className={'overlay bottom' + (closing ? ' closing' : '')}
      onClick={(e) => e.target === e.currentTarget && close()}
    >
      <div className="modal sheet" role="dialog" aria-modal="true" aria-labelledby="addrTitle">
        <h2 id="addrTitle" className="sheet-title">
          Deliver to
        </h2>
        <ul className="addr-pick" role="radiogroup" aria-label="Your addresses">
          {list.map((a) => (
            <li key={a.id}>
              <button
                role="radio"
                aria-checked={a.address.toLowerCase() === (current || '').toLowerCase()}
                onClick={() => close(() => onPick(a))}
              >
                <span className="co-pin" aria-hidden="true">
                  <PinIcon />
                </span>
                <div>
                  <strong>{a.address}</strong>
                  {a.area && <span className="sub">{a.area}</span>}
                </div>
              </button>
            </li>
          ))}
        </ul>
        <button className="btn ghost" onClick={() => close(onNew)}>
          Use a new address
        </button>
      </div>
    </div>
  );
}
