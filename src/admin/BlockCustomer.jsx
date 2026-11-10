// Block a customer who abuses ShopDesk (threats, fake reports, scams): they can't order, write or report until you
// unblock them. Shops that misbehave are suspended instead. Needs a reason; it goes in the Log.
import React, { useState } from 'react';
import { supabase } from '../lib/database.js';
import { errText } from '../lib/helpers.js';

export function BlockCustomer({ id, name, blocked, after }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  if (!id) return null;
  async function go() {
    setBusy(true);
    setErr('');
    const { error } = await supabase.rpc('admin_block_user', {
      p_user: id,
      p_block: !blocked,
      p_reason: note,
    });
    setBusy(false);
    if (error) return setErr(errText(error));
    setOpen(false);
    setNote('');
    after(blocked ? `${name} can use ShopDesk again.` : `${name} is blocked.`);
  }
  if (!open)
    return (
      <div className="btns">
        {blocked && <span className="chip owe">Blocked</span>}
        <button className="linkbtn" onClick={() => setOpen(true)}>
          {blocked ? 'Unblock' : 'Block this customer'}
        </button>
      </div>
    );
  return (
    <div className="stack-sm">
      <div className="field">
        <label htmlFor={'blk' + id}>{blocked ? 'Why unblock?' : 'Why block?'} (goes in the Log)</label>
        <input id={'blk' + id} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
      </div>
      {err && <p className="err">{err}</p>}
      <div className="btns">
        <button className="btn small" onClick={go} disabled={busy}>
          {blocked ? 'Unblock' : 'Block'} {name}
        </button>
        <button className="btn small ghost" onClick={() => setOpen(false)}>
          Back
        </button>
      </div>
    </div>
  );
}
