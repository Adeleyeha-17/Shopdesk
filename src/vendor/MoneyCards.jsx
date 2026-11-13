// On the Shop tab, once Admin switches them on: the pickup address for ShopDesk Delivery, and what paying online
// means for the shop.
import React, { useState } from 'react';
import { supabase } from '../lib/database.js';
import { useMoneySwitches } from '../lib/moneyApi.js';
import { errText } from '../lib/helpers.js';

const ONLINE_BANKS = ['OPay', 'Moniepoint', 'Kuda', 'PalmPay'];

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
  const online = ONLINE_BANKS.includes(shop.bank) && /^\d{10}$/.test(shop.account_number || '');
  return (
    <>
      {sw.delivery && (
        <section className="card">
          <h2>ShopDesk Delivery</h2>
          <p className="note">
            Get courier prices on new orders and pick one. ShopDesk books the courier and pays them, and you and your
            customer follow the delivery on the order.
          </p>
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
          <p className="note">
            When the customer pays online, the delivery fee comes to ShopDesk with their payment. When they pay you by
            transfer, the delivery goes on your delivery bill.
          </p>
        </section>
      )}
      {sw.online && (
        <section className="card">
          <h2>Customers pay online</h2>
          {online ? (
            <p className="note">
              Customers can pay with card, transfer or USSD on their order page, and the order is marked paid by itself.
              The money goes straight to your {shop.bank} account through Paystack, usually by the next working day.
              {sw.fee_by === 'shop' ? ' Paystack keeps its fee (1.5% + ₦100, at most ₦2,000) from each payment.' : ''}
            </p>
          ) : (
            <p className="note">
              Customers can pay you online when the account under Your shop is OPay, Moniepoint, Kuda or PalmPay. Until
              then, they pay by transfer.
            </p>
          )}
        </section>
      )}
    </>
  );
}
