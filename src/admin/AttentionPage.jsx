// Needs attention: warning signs across all shops (unconfirmed payments, late deliveries, bank changes, reports...).
import React from 'react';
import { waLink } from '../lib/helpers.js';
import { short } from './adminHelpers.js';

// ---------- Needs attention ----------
export function AttentionPage({ d }) {
  const groups = [
    [1, 'Act now', 'Money or trust is at risk.'],
    [2, 'Keep an eye on', 'Not urgent, but worth a message.'],
  ];
  return (
    <>
      <div className="page-head">
        <h1>Needs attention</h1>
        <span className="sub">Checked every minute. Customer names and numbers stay private.</span>
      </div>
      {!d.attention.length && (
        <section className="panel">
          <p className="note">All clear. Nothing needs you right now.</p>
        </section>
      )}
      {groups.map(([lv, title, sub]) => {
        const list = d.attention.filter((a) => a.level === lv);
        if (!list.length) return null;
        return (
          <section className="panel" key={lv}>
            <div className="panel-head">
              <h3>
                <span className={'dot' + (lv === 1 ? ' bad' : ' wait')} />
                {title}
              </h3>
              <span className="sub">{sub}</span>
            </div>
            <div className="table-wrap">
              <table className="t">
                <thead>
                  <tr>
                    <th>Shop</th>
                    <th>What's happening</th>
                    <th>Since</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {list.map((a, i) => (
                    <tr key={i}>
                      <td className="name">
                        <a href={'#shop/' + a.shop_id}>
                          <strong>{a.shop}</strong>
                        </a>
                      </td>
                      <td className="wrap">{a.text}</td>
                      <td>{a.since ? short(a.since) : ''}</td>
                      <td className="r">
                        <div className="btns end">
                          {['problems', 'refund_overdue', 'refund_disputed'].includes(a.kind) && (
                            <a className="btn small" href="#problems">
                              Open Problems
                            </a>
                          )}
                          {['reports', 'chat_reports', 'other_account'].includes(a.kind) && (
                            <a className="btn small" href="#reports">
                              Open Reports
                            </a>
                          )}
                          <a className="btn small ghost" href={'#shop/' + a.shop_id}>
                            Open shop
                          </a>
                          {a.whatsapp && (
                            <a
                              className="btn small ghost"
                              href={waLink(a.whatsapp, `Hi ${a.shop}, this is ShopDesk. `)}
                              target="_blank"
                              rel="noopener"
                            >
                              WhatsApp
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </>
  );
}
