// The Shop tab: the shop's order link, its details, its rules (payment and delivery) and sign out.
import React, { useState } from 'react';
import { supabase } from '../lib/database.js';
import { signOut } from '../lib/alerts.js';
import { EmailSwitch } from '../shared/EmailSwitch.jsx';
import { ThemePicker } from '../shared/ThemePicker.jsx';
import { errText, copyText } from '../lib/helpers.js';
import { ShopFields, checkShop, shopRow } from './shopForm.jsx';

export function ShopTab({ shop, reloadShop, say, email }) {
  const [v, setV] = useState({ ...shop, slugTouched: true });
  const [err, setErr] = useState('');
  const link = `${window.location.origin}/${shop.slug}`;
  async function save() {
    const bad = checkShop(v);
    if (bad) {
      setErr(bad);
      return;
    }
    const { error } = await supabase.from('shops').update(shopRow(v)).eq('id', shop.id);
    if (error)
      setErr(
        /duplicate|unique|slug_reserved/i.test(error.message)
          ? 'That link name is taken. Try another.'
          : errText(error),
      );
    else {
      setErr('');
      say('Saved.');
      reloadShop();
    }
  }
  async function rule(patch) {
    const { error } = await supabase.from('shops').update(patch).eq('id', shop.id);
    if (error) say(errText(error));
    else {
      say('Rule saved.');
      reloadShop();
    }
  }
  const Choice = ({ on, title, sub, click }) => (
    <button className="choice" role="radio" aria-checked={on} onClick={click}>
      <strong>{title}</strong>
      <span>{sub}</span>
      <i aria-hidden="true" />
    </button>
  );
  return (
    <>
      <section className="card">
        <h2>Your order link</h2>
        <div className="slip">
          <span className="mono">{link}</span>
          <span className="sub">
            {shop.status === 'active'
              ? 'Share it on WhatsApp and Instagram.'
              : 'Opens once ShopDesk approves you.'}
          </span>
        </div>
        <div className="btns">
          <button
            className="btn small"
            onClick={() =>
              copyText(
                `Order from ${shop.name} here: ${link}?s=wa\nPick what you want and I see your order straight away.`,
                say,
                'WhatsApp message copied',
              )
            }
          >
            Copy WhatsApp message
          </button>
          <a
            className="btn small ghost"
            href={'/' + shop.slug}
            target="_blank"
            rel="noopener"
            style={{ textDecoration: 'none' }}
          >
            Open my order page
          </a>
        </div>
      </section>
      <section className="card">
        <h2>Your shop</h2>
        <ShopFields v={v} set={setV} />
        {shop.status === 'active' && <p className="note">ShopDesk sees payment account changes.</p>}
        {err && <p className="err">{err}</p>}
        <button className="btn" onClick={save}>
          Save
        </button>
      </section>
      <section className="card">
        <h2>Your rules</h2>
        <p className="label">Payment</p>
        <div className="choices" role="radiogroup" aria-label="Payment">
          <Choice
            on={!shop.allow_part_payment}
            title="Full payment, one transfer"
            sub="Nothing is packed until the whole amount is in."
            click={() => rule({ allow_part_payment: false })}
          />
          <Choice
            on={shop.allow_part_payment}
            title="Allow part payment"
            sub="The customer can pay part now and the rest before delivery."
            click={() => rule({ allow_part_payment: true })}
          />
        </div>
        <p className="label">Delivery fee</p>
        <div className="choices" role="radiogroup" aria-label="Delivery fee">
          <Choice
            on={shop.delivery_paid_by === 'customer'}
            title="Customer pays delivery"
            sub="For each order you type in what the rider will collect. It's added to the customer's total before they pay."
            click={() => rule({ delivery_paid_by: 'customer' })}
          />
          <Choice
            on={shop.delivery_paid_by === 'vendor'}
            title="I cover delivery"
            sub="Customers see free delivery. There's no delivery fee to type in."
            click={() => rule({ delivery_paid_by: 'vendor' })}
          />
        </div>
        <p className="note">New rules apply to new orders.</p>
      </section>
      <ThemePicker />
      <section className="card">
        <h2>Account</h2>
        <p className="note">Signed in as {email}.</p>
        <EmailSwitch />
        <div className="btns">
          <a className="btn small ghost" href="/privacy" style={{ textDecoration: 'none' }}>
            Rules and privacy
          </a>
          <button className="btn small ghost" onClick={signOut}>
            Sign out
          </button>
        </div>
      </section>
    </>
  );
}
