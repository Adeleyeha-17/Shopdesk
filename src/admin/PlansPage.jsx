// Plans & payments: your price, trial and grace days, where vendors pay you, and every shop's plan.
import React, { useState } from 'react';
import { supabase } from '../lib/database.js';
import { naira, toInt } from '../lib/money.js';
import { dayOf } from '../lib/dates.js';
import { errText, waLink } from '../lib/helpers.js';
import { short, k, planState } from './adminHelpers.js';
import { BarChart } from './BarChart.jsx';

// ---------- Plans & payments ----------
export function PlansPage({ d, setModal, say, load }) {
  const b = d.billing;
  const [v, setV] = useState(() => ({ ...b.settings }));
  const [err, setErr] = useState('');
  const f = (key) => (e) => setV({ ...v, [key]: e.target.value });
  async function save() {
    const price = toInt(v.monthly_price),
      trial = toInt(v.trial_days),
      grace = toInt(v.grace_days);
    if (price == null || trial == null || grace == null) {
      setErr('Enter numbers for the price, trial and grace days.');
      return;
    }
    const { error } = await supabase.rpc('admin_save_settings', {
      p: {
        monthly_price: price,
        trial_days: trial,
        grace_days: grace,
        close_unpaid: !!v.close_unpaid,
        pay_bank: v.pay_bank,
        pay_account_number: v.pay_account_number,
        pay_account_name: v.pay_account_name,
        admin_whatsapp: v.admin_whatsapp,
      },
    });
    if (error) setErr(errText(error));
    else {
      setErr('');
      say('Plan settings saved.');
      load();
    }
  }
  const months = b.months.map((m) => ({ x: m.month, v: m.income }));
  const thisM = months.length ? months[months.length - 1].v : 0;
  const lastM = months.length > 1 ? months[months.length - 2].v : 0;
  const paying = b.shops.filter(
    (s) => s.last_paid && s.paid_until && new Date(s.paid_until) > new Date(),
  ).length;
  const remind = (s) =>
    `Hi ${s.name}, this is ShopDesk. Your plan ${new Date(s.paid_until) < new Date() ? 'ended' : 'ends'} on ${dayOf(s.paid_until)}. ` +
    `It's ${naira(b.settings.monthly_price)} a month${b.settings.pay_account_number ? `, paid to ${b.settings.pay_bank} ${b.settings.pay_account_number} (${b.settings.pay_account_name})` : ''}. Send the proof here and we'll extend it.`;
  return (
    <>
      <div className="page-head">
        <h1>Plans & payments</h1>
        <span className="sub">What vendors pay you, and when shops close for not paying.</span>
      </div>
      <div className="tiles">
        <div className="tile">
          <span className="label">Income this month</span>
          <span className="big num">{naira(thisM)}</span>
        </div>
        <div className="tile">
          <span className="label">Last month</span>
          <span className="big num">{naira(lastM)}</span>
        </div>
        <div className="tile">
          <span className="label">Shops paying</span>
          <span className="big num">{paying}</span>
          <span className="sub">of {b.shops.length} approved</span>
        </div>
        <div className="tile">
          <span className="label">Price</span>
          <span className="big num">{naira(b.settings.monthly_price)}</span>
          <span className="sub">a month</span>
        </div>
      </div>
      <div className="grid2">
        <section className="panel">
          <div className="panel-head">
            <h3>Your plan settings</h3>
          </div>
          <div className="form2">
            <div className="field">
              <label htmlFor="pPrice">Price a month (₦)</label>
              <input id="pPrice" inputMode="numeric" value={v.monthly_price} onChange={f('monthly_price')} />
            </div>
            <div className="field">
              <label htmlFor="pTrial">Free trial after approval (days)</label>
              <input id="pTrial" inputMode="numeric" value={v.trial_days} onChange={f('trial_days')} />
            </div>
            <div className="field">
              <label htmlFor="pGrace">Grace days after the plan ends</label>
              <input id="pGrace" inputMode="numeric" value={v.grace_days} onChange={f('grace_days')} />
            </div>
            <div className="field">
              <span>Close shops that don't pay</span>
              <label className="row" style={{ justifyContent: 'flex-start', gap: 8, fontWeight: 400 }}>
                <input
                  type="checkbox"
                  checked={!!v.close_unpaid}
                  onChange={(e) => setV({ ...v, close_unpaid: e.target.checked })}
                />
                <span className="sub">
                  After the grace days their page closes. It reopens when you record a payment.
                </span>
              </label>
            </div>
            <div className="field">
              <label htmlFor="pBank">Vendors pay you at (bank)</label>
              <input id="pBank" value={v.pay_bank} onChange={f('pay_bank')} placeholder="e.g. Moniepoint" />
            </div>
            <div className="field">
              <label htmlFor="pNum">Account number</label>
              <input
                id="pNum"
                inputMode="numeric"
                value={v.pay_account_number}
                onChange={f('pay_account_number')}
              />
            </div>
            <div className="field">
              <label htmlFor="pName">Account name</label>
              <input id="pName" value={v.pay_account_name} onChange={f('pay_account_name')} />
            </div>
            <div className="field">
              <label htmlFor="pWa">Your WhatsApp (vendors send proof here)</label>
              <input id="pWa" inputMode="tel" value={v.admin_whatsapp} onChange={f('admin_whatsapp')} />
            </div>
          </div>
          {err && <p className="err">{err}</p>}
          <div className="btns">
            <button className="btn small" onClick={save}>
              Save settings
            </button>
          </div>
        </section>
        <BarChart
          title="Your income per month"
          data={months}
          fmt={(x) => '₦' + k(x)}
          when={(t) => new Date(t).toLocaleDateString('en-NG', { month: 'short' })}
        />
      </div>
      <section className="panel flush">
        <div className="panel-head pad">
          <h3>Every shop's plan</h3>
          <span className="sub">soonest to end first</span>
        </div>
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Shop</th>
                <th>Plan</th>
                <th>Last paid</th>
                <th className="r">Paid in all</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {b.shops.map((s) => {
                const p = planState(s, b.settings);
                return (
                  <tr key={s.id}>
                    <td className="name">
                      <a href={'#shop/' + s.id}>
                        <strong>{s.name}</strong>
                      </a>
                      {s.status === 'suspended' && <span className="sub"> · suspended</span>}
                    </td>
                    <td>{p.tone ? <span className={'chip ' + p.tone}>{p.label}</span> : p.label}</td>
                    <td>{s.last_paid ? short(s.last_paid) : 'Never'}</td>
                    <td className="r num">{naira(s.paid_total)}</td>
                    <td className="r">
                      <div className="btns end">
                        {s.whatsapp && s.paid_until && (
                          <a
                            className="btn small ghost"
                            href={waLink(s.whatsapp, remind(s))}
                            target="_blank"
                            rel="noopener"
                          >
                            Remind
                          </a>
                        )}
                        <button
                          className="btn small"
                          onClick={() =>
                            setModal({ kind: 'payment', shop: s, price: b.settings.monthly_price })
                          }
                        >
                          Record payment
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!b.shops.length && (
          <p className="note" style={{ padding: 16 }}>
            No approved shops yet.
          </p>
        )}
      </section>
      <section className="panel flush">
        <div className="panel-head pad">
          <h3>Recent payments</h3>
        </div>
        {b.payments.length ? (
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Shop</th>
                  <th className="r">Amount</th>
                  <th>Months</th>
                  <th>Now paid until</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {b.payments.map((pp, i) => (
                  <tr key={i}>
                    <td>{short(pp.created_at)}</td>
                    <td className="name">{pp.shop}</td>
                    <td className="r num">{naira(pp.amount)}</td>
                    <td>{pp.months}</td>
                    <td>{short(pp.paid_until)}</td>
                    <td className="wrap">{pp.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="note" style={{ padding: '0 16px 16px' }}>
            No payments recorded yet.
          </p>
        )}
      </section>
    </>
  );
}
