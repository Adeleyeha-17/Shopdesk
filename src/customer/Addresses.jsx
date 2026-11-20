// A customer's delivery addresses (home, office...). Account → Addresses lists them, with Add, Edit and Remove; at
// checkout, Change opens the list to pick from, or to type a new one. An address used at checkout is saved when the
// order is placed.
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

// The form for a new address, or for changing one: the address, and the area it's in.
function AddressForm({ start, saveLabel, onSave, onCancel, onRemove }) {
  const [draft, setDraft] = useState(start);
  const [areaOpen, setAreaOpen] = useState(false);
  const area = draft.area || areaIn(draft.address);
  return (
    <div className="stack-sm addr-form">
      <div className="field">
        <label htmlFor="newAddr">{start.address ? 'Address' : 'New address'}</label>
        <input
          id="newAddr"
          autoComplete="street-address"
          value={draft.address}
          onChange={(e) => setDraft({ ...draft, address: e.target.value })}
          placeholder="House number, street and area"
          autoFocus
        />
        <span className="area-line">
          {area ? (
            <>
              Area: <strong>{area}</strong>
            </>
          ) : (
            'Add the area so shops know where it is.'
          )}{' '}
          <button className="linkbtn" onClick={() => setAreaOpen(true)}>
            {area ? 'Change' : 'Pick area'}
          </button>
        </span>
      </div>
      <div className="btns">
        <button className="btn small" onClick={() => onSave(draft)}>
          {saveLabel}
        </button>
        <button className="linkbtn" onClick={onCancel}>
          Cancel
        </button>
        {onRemove && (
          <button className="linkbtn bad push-right" onClick={onRemove}>
            Remove
          </button>
        )}
      </div>
      {areaOpen && (
        <AreaPicker
          value={draft.area}
          onPick={(a) => setDraft((d) => ({ ...d, area: a }))}
          onClose={() => setAreaOpen(false)}
        />
      )}
    </div>
  );
}

// Account → Addresses: "Add a new address" on top, then each address with an Edit pencil (Remove is inside Edit).
export function AccountAddresses({ userId }) {
  const [list, setList] = useState(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null); // the id being changed
  const [msg, setMsg] = useState('');
  const reload = useCallback(() => loadAddresses().then(setList), []);
  useEffect(() => {
    reload();
  }, [reload]);
  // the address as typed, cut to size, with its area (picked, or read from the address)
  function clean(d) {
    const address = d.address.trim().slice(0, 160);
    return { address, area: (d.area || areaIn(address) || '').slice(0, 40) };
  }
  const said = (error) => (/duplicate|unique/i.test(error.message) ? 'You saved this address already.' : errText(error));
  async function add(d) {
    const row = clean(d);
    if (row.address.length < 3) return setMsg('Type the address: house number, street and area.');
    const { error } = await supabase.from('customer_addresses').insert({ user_id: userId, ...row });
    if (error) return setMsg(said(error));
    setMsg('');
    setAdding(false);
    reload();
  }
  async function change(id, d) {
    const row = clean(d);
    if (row.address.length < 3) return setMsg('Type the address: house number, street and area.');
    const { error } = await supabase.from('customer_addresses').update(row).eq('id', id);
    if (error) return setMsg(said(error));
    setMsg('');
    setEditing(null);
    reload();
  }
  async function remove(id) {
    const { error } = await supabase.from('customer_addresses').delete().eq('id', id);
    if (error) setMsg(errText(error));
    else reload();
  }
  return (
    <>
      {adding ? (
        <section className="card boxed">
          <AddressForm
            start={{ address: '', area: '' }}
            saveLabel="Save address"
            onSave={add}
            onCancel={() => {
              setAdding(false);
              setMsg('');
            }}
          />
        </section>
      ) : (
        <button
          className="addr-add"
          onClick={() => {
            setAdding(true);
            setEditing(null);
            setMsg('');
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Add a new address
        </button>
      )}
      {msg && <p className="note">{msg}</p>}
      {list && list.length > 0 && (
        <section className="card boxed" aria-label="Addresses">
          <ul className="addr-list">
            {list.map((a, i) =>
              editing === a.id ? (
                <li key={a.id} className="editing">
                  <AddressForm
                    start={{ address: a.address, area: a.area }}
                    saveLabel="Save changes"
                    onSave={(d) => change(a.id, d)}
                    onRemove={() => remove(a.id)}
                    onCancel={() => {
                      setEditing(null);
                      setMsg('');
                    }}
                  />
                </li>
              ) : (
                <li key={a.id}>
                  <span className="co-pin" aria-hidden="true">
                    <PinIcon />
                  </span>
                  <div>
                    <strong>{a.address}</strong>
                    <span className="sub">{[a.area, i === 0 ? 'Used last' : ''].filter(Boolean).join(' · ')}</span>
                  </div>
                  <button
                    className="icon-btn"
                    onClick={() => {
                      setEditing(a.id);
                      setAdding(false);
                      setMsg('');
                    }}
                    aria-label={'Edit ' + a.address}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />
                    </svg>
                  </button>
                </li>
              ),
            )}
          </ul>
        </section>
      )}
      {list && !list.length && !adding && (
        <p className="sub addr-none">Addresses you deliver to are saved here when you order.</p>
      )}
    </>
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
