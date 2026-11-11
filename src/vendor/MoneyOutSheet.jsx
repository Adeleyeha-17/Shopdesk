// "Add money out": what the shop spent (restock, packaging, transport...), so the Sales tab can show what's left.
// A bottom sheet: the amount, what it was for, an optional note and the date (today unless changed).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/database.js';
import { toInt, naira } from '../lib/money.js';
import { errText } from '../lib/helpers.js';
import { OUT_KINDS } from './report.js';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function MoneyOutSheet({ shop, onClose, onSaved }) {
  const [amount, setAmount] = useState('');
  const [kind, setKind] = useState('restock');
  const [note, setNote] = useState('');
  const [day, setDay] = useState(today());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
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
    if (box.current) box.current.focus({ preventScroll: true });
    return () => window.removeEventListener('keydown', key);
  }, [close]);

  async function save() {
    const n = toInt(amount);
    if (!n) {
      setErr('Type how much you spent.');
      return;
    }
    setBusy(true);
    setErr('');
    const row = {
      shop_id: shop.id,
      amount: n,
      kind,
      note: note.trim().slice(0, 80),
      spent_on: day || today(),
    };
    const { error } = await supabase.from('money_out').insert(row);
    setBusy(false);
    if (error) setErr(errText(error));
    else onSaved(row);
  }

  return (
    <div
      className={'overlay bottom' + (closing ? ' closing' : '')}
      onClick={(e) => e.target === e.currentTarget && close()}
    >
      <div className="modal sheet" role="dialog" aria-modal="true" aria-labelledby="outTitle">
        <div className="row">
          <h2 id="outTitle" className="sheet-title">
            Add money out
          </h2>
          <button className="linkbtn" onClick={close}>
            Cancel
          </button>
        </div>
        <div className="field">
          <label htmlFor="outAmount">How much</label>
          <input
            id="outAmount"
            ref={box}
            inputMode="numeric"
            placeholder="₦0"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d,₦]/g, ''))}
          />
          {toInt(amount) > 0 && <span className="sub">{naira(toInt(amount))}</span>}
        </div>
        <div className="field">
          <span>What for</span>
          <div className="kinds" role="radiogroup" aria-label="What for">
            {OUT_KINDS.filter(([k]) => k !== 'shopdesk').map(([k, l]) => (
              <button
                key={k}
                className="filter"
                role="radio"
                aria-checked={kind === k}
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label htmlFor="outNote">Note (optional)</label>
          <input
            id="outNote"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. 2 cartons of shea butter"
            maxLength={80}
          />
        </div>
        <div className="field">
          <label htmlFor="outDay">Date</label>
          <input id="outDay" type="date" value={day} max={today()} onChange={(e) => setDay(e.target.value)} />
        </div>
        {err && (
          <p className="err" role="alert">
            {err}
          </p>
        )}
        <button className="btn" onClick={save} disabled={busy}>
          {busy ? 'Adding…' : 'Add money out'}
        </button>
      </div>
    </div>
  );
}
