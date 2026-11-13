// On the Shop tab, once Admin switches them on: the pickup address for ShopDesk Delivery, and what paying online
// means for the shop.
import React, { useState } from 'react';
import { supabase } from '../lib/database.js';
import { useMoneySwitches } from '../lib/moneyApi.js';
import { errText } from '../lib/helpers.js';

export function MoneyCards({ shop, reloadShop, say }) {
  const sw = useMoneySwitches();
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
      {sw.delivery && (
        <section className="card">
          <h2>ShopDesk Delivery</h2>
          <p className="note">
            Every delivery order goes with ShopDesk Delivery: pick a courier on the new order, and ShopDesk books and
            pays them. Your customer pays online, and you both follow the delivery on the order. Pick-up orders can
            still be paid to you by transfer.
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
              Customers can pay with card, transfer or USSD on their order page, and the order is marked paid by itself.
              The money goes straight to your {shop.bank} account through Paystack, usually by the next working day.
              {sw.fee_by === 'customer'
                ? ' Customers who pay online also pay the card fee and a small ShopDesk fee, so you get the full amount. Transfers to you stay free.'
                : sw.fee_by === 'shop'
                  ? ' Paystack keeps its fee (1.5% + ₦100, at most ₦2,000) from each payment.'
                  : ''}
            </p>
          ) : (
            <p className="note">
              Customers can pay you online once you pick your bank by name under Your shop, not Other bank. Until then,
              they pay by transfer.
            </p>
          )}
        </section>
      )}
    </>
  );
}
