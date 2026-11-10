// "Set up your shop": the first screen for a new vendor. The shop is sent to ShopDesk for approval.
// An email that has already been used to shop can't open a shop (one email, one role).
import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/database.js';
import { signOut } from '../lib/alerts.js';
import { errText } from '../lib/helpers.js';
import { VendorFrame } from './VendorFrame.jsx';
import { ShopFields, checkShop, shopRow } from './shopForm.jsx';

export function SetUpShop({ userId, email, onDone, isOwner }) {
  const [v, setV] = useState({
    name: '',
    slug: '',
    bank: 'OPay',
    account_number: '',
    account_name: '',
    whatsapp: '',
    sells: '',
    location: '',
    social: '',
  });
  const [agree, setAgree] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [isCustomer, setIsCustomer] = useState(null);
  // One email, one role: an email that has shopped on ShopDesk can't open a shop.
  useEffect(() => {
    supabase.rpc('my_account').then(({ data }) => setIsCustomer(!!(data && data.customer)));
  }, []);
  const ownerCard = isOwner && (
    <section className="card boxed">
      <h2>You're the ShopDesk admin</h2>
      <p className="note">Admin is separate. Open a shop here only to test selling.</p>
      <a className="btn" href="/admin" style={{ textAlign: 'center', textDecoration: 'none' }}>
        Open ShopDesk Admin
      </a>
    </section>
  );
  if (isCustomer === null)
    return (
      <VendorFrame>
        <p className="note">Loading…</p>
      </VendorFrame>
    );
  if (isCustomer)
    return (
      <VendorFrame
        right={
          <button className="linkbtn" onClick={signOut}>
            Sign out
          </button>
        }
      >
        {ownerCard}
        <section className="card">
          <h2>This email is a customer account</h2>
          <p className="note">{email} is a customer account. Use another email for your shop.</p>
          <div className="btns">
            <button className="btn small" onClick={signOut}>
              Sign out
            </button>
            <a className="linkbtn" href="/orders">
              See my orders
            </a>
          </div>
        </section>
      </VendorFrame>
    );
  async function save() {
    const bad = checkShop(v) || (!agree ? 'Tick the box to accept the shop rules.' : '');
    if (bad) {
      setErr(bad);
      return;
    }
    setBusy(true);
    const { error } = await supabase.from('shops').insert({ owner_id: userId, ...shopRow(v) });
    setBusy(false);
    if (error)
      setErr(
        /duplicate|unique|slug_reserved/i.test(error.message)
          ? 'That link name is taken. Try another.'
          : errText(error),
      );
    else onDone();
  }
  return (
    <VendorFrame
      right={
        <button className="linkbtn" onClick={signOut}>
          Sign out
        </button>
      }
    >
      {ownerCard}
      <div>
        <h2>Set up your shop</h2>
        <p className="note">ShopDesk checks every new shop, usually within a day. Add products meanwhile.</p>
      </div>
      <section className="card">
        <ShopFields v={v} set={setV} />
      </section>
      <label className={'agree' + (agree ? ' on' : '')}>
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <span>
          I accept the{' '}
          <a href="/privacy#rules" target="_blank" rel="noopener">
            shop rules
          </a>
          : real goods only, no taking money without delivering, refunds for cancelled orders, and customers'
          details used only for their orders.
        </span>
      </label>
      {err && <p className="err">{err}</p>}
      <button className="btn" onClick={save} disabled={busy}>
        {busy ? 'Sending…' : 'Send my shop for approval'}
      </button>
    </VendorFrame>
  );
}
