// On the Shop tab, once Admin switches them on: the pickup address for ShopDesk Delivery, and what paying online
// means for the shop. Until then, each shows as "Coming soon" with an "I want this" button (Admin sees how many tapped
// it, and the shops that did hear when it's switched on).
import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/database.js';
import { useMoneySwitches } from '../lib/moneyApi.js';
import { errText } from '../lib/helpers.js';

const SOON = {
  pay_online: ['Customers pay online', 'Card, transfer or USSD. The money goes to your account.'],
  delivery: ['ShopDesk Delivery', 'We book a courier to your door. You just pack.'],
};

function ComingSoon({ feature, wanted, want }) {
  const [title, text] = SOON[feature];
  return (
    <section className="card soon">
      <div className="soon-head">
        <h2>{title}</h2>
        <em className="tag">Coming soon</em>
      </div>
      <p className="note">{text}</p>
      {wanted ? (
        <span className="soon-ok">✓ We'll tell you when it's here</span>
      ) : (
        <button className="btn small" onClick={() => want(feature)}>
          I want this
        </button>
      )}
    </section>
  );
}

export function MoneyCards({ shop, reloadShop, say }) {
  const sw = useMoneySwitches();
  const [wants, setWants] = useState([]);
  useEffect(() => {
    supabase.rpc('my_feature_wants').then(({ data, error }) => !error && setWants(data || []));
  }, []);
  async function want(f) {
    setWants((w) => [...w, f]);
    const { error } = await supabase.rpc('want_feature', { p_feature: f });
    if (error) {
      setWants((w) => w.filter((x) => x !== f));
      say(errText(error));
    }
  }
  const [addr, setAddr] = useState(shop.pickup_address || '');
  const [busy, setBusy] = useState(false);
  async function save() {
    const v = addr.trim().replace(/\s+/g, ' ');
    if (v.length < 10) {
      say('Add the street, area and city, e.g. 5 Herbert Macaulay Way, Yaba, Lagos.');
      return;
    }
    setBusy(true);
    const { error } = await supabase.from('shops').update({ pickup_address: v }).eq('id', shop.id);
    setBusy(false);
    if (error) say(errText(error));
    else {
      say('Pickup address saved.');
      reloadShop();
    }
  }
  const online = shop.bank !== 'Other bank' && /^\d{10}$/.test(shop.account_number || '');
  return (
    <>
      {sw.loaded && !sw.online && <ComingSoon feature="pay_online" wanted={wants.includes('pay_online')} want={want} />}
      {sw.loaded && !sw.delivery && <ComingSoon feature="delivery" wanted={wants.includes('delivery')} want={want} />}
      {sw.delivery && (
        <section className="card">
          <h2>ShopDesk Delivery</h2>
          <p className="note">
            A courier picks up from you and delivers to the door.
          </p>
          {!online && (
            <p className="err">
              Customers pay delivery orders online, so pick your bank by name under Your shop, not Other bank.
            </p>
          )}
          <div className="field">
            <label htmlFor="pickup">Pickup address</label>
            <input
              id="pickup"
              value={addr}
              maxLength={200}
              autoComplete="street-address"
              placeholder="e.g. 5 Herbert Macaulay Way, Yaba, Lagos"
              onChange={(e) => setAddr(e.target.value)}
            />
            <span className="field-hint">Where the courier collects your orders. Add the street, area and city.</span>
          </div>
          {addr.trim() !== (shop.pickup_address || '') && (
            <button className={'btn' + (busy ? ' busy' : '')} onClick={save} disabled={busy}>
              Save pickup address
            </button>
          )}
        </section>
      )}
      {sw.online && (
        <section className="card">
          <h2>Customers pay online</h2>
          {online ? (
            <p className="note">
              Paid straight to your {shop.bank} account{sw.fee_by === 'shop' ? ', minus the payment fee.' : ', in full.'}
            </p>
          ) : (
            <p className="note">
              Pick your bank by name under Your shop to get paid online.
            </p>
          )}
        </section>
      )}
    </>
  );
}
