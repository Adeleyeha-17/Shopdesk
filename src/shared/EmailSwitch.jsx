// Email backup on or off: one email with what you missed, when you haven't opened ShopDesk for 10 minutes.
import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/database.js';
import { errText } from '../lib/helpers.js';

export function EmailSwitch() {
  const [s, setS] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    supabase.rpc('my_email_settings').then(({ data }) => setS(data || null));
  }, []);
  if (!s) return null;
  async function flip() {
    const before = s;
    setS({ ...s, on: !s.on });
    setErr('');
    const { error } = await supabase.rpc('set_email_alerts', { p_on: !before.on });
    if (error) {
      setS(before);
      setErr(errText(error));
    }
  }
  return (
    <div className="switch-row">
      <div className="switch-text">
        <strong id="emailSwitch">Email me what I miss</strong>
        <span className="sub">After 10 minutes away · {s.email}</span>
      </div>
      <button
        type="button"
        role="switch"
        className="switch"
        aria-checked={s.on}
        aria-labelledby="emailSwitch"
        onClick={flip}
      >
        <span />
      </button>
      {err && <p className="err">{err}</p>}
    </div>
  );
}
