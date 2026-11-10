// Reports: what customers reported about a shop, and messages either side reported (rude, threats, scams), with the
// order it's about (what was ordered, the money, each step, and the chat). Closed ones stay below.
// Log: every admin action, shop change, and what ShopDesk did by itself.
import React, { useState } from 'react';
import { atText, dayOf } from '../lib/dates.js';
import { PhotoStrip } from '../shared/OrderPhotos.jsx';
import { BlockCustomer } from './BlockCustomer.jsx';
import { short } from './adminHelpers.js';
import { AdminOrder } from './AdminOrder.jsx';

export function ReportsPage({ d, setModal, say, load }) {
  const [showClosed, setShowClosed] = useState(false);
  const open = d.reports.filter((r) => !r.resolved_at);
  const closed = d.reports.filter((r) => r.resolved_at);
  return (
    <>
      <div className="page-head">
        <h1>Reports</h1>
        <span className="sub">
          About shops, and messages from either side. Close each one when it's handled.
        </span>
      </div>
      {!open.length && (
        <section className="panel">
          <p className="note">No open reports.</p>
        </section>
      )}
      {open.map((r) => (
        <Report key={r.id} r={r} setModal={setModal} say={say} load={load} />
      ))}
      {closed.length > 0 && (
        <div className="btns">
          <button className="linkbtn" onClick={() => setShowClosed(!showClosed)}>
            {showClosed ? 'Hide closed reports' : `Closed reports (${closed.length})`}
          </button>
        </div>
      )}
      {showClosed && closed.map((r) => <Report key={r.id} r={r} setModal={setModal} say={say} load={load} />)}
    </>
  );
}

function Report({ r, setModal, say, load }) {
  const m = r.message;
  return (
    <section className={'panel' + (r.resolved_at ? ' done' : '')}>
      <div className="panel-head">
        <h3>
          {m ? (r.about === 'customer' ? 'Customer’s message · ' : 'Shop’s message · ') : ''}
          <a href={'#shop/' + r.shop_id}>{r.shop}</a>
        </h3>
        <span className="sub">{short(r.created_at)}</span>
      </div>
      {m ? (
        <>
          <div className="msg theirs">
            {m.photo && <PhotoStrip paths={[m.photo]} label="Photo" />}
            {m.body && <p>{m.body}</p>}
            <span className="msg-time">{atText(m.created_at)}</span>
          </div>
          <span className="sub">
            Reported by the {r.about === 'customer' ? 'shop' : 'customer'}: {r.reason}
          </span>
        </>
      ) : (
        <p className="problem-quote">“{r.reason}”</p>
      )}
      {(r.reporter || r.contact) && (
        <span className="sub">{[r.reporter, r.contact].filter(Boolean).join(' · ')}</span>
      )}
      {r.customer && (
        <div className="stack-sm">
          <span className="label">
            The customer · {r.customer.name}
            {r.customer.email ? ' · ' + r.customer.email : ''}
          </span>
          <BlockCustomer
            id={r.customer.id}
            name={r.customer.name}
            blocked={r.customer.blocked}
            after={(t) => {
              say(t);
              load();
            }}
          />
        </div>
      )}
      {r.order ? (
        <AdminOrder o={r.order} />
      ) : r.their_orders && r.their_orders.length ? (
        <>
          <span className="label">Their orders with this shop</span>
          {r.their_orders.map((o) => (
            <AdminOrder key={o.id} o={o} />
          ))}
        </>
      ) : (
        <p className="sub">Not about an order.</p>
      )}
      {r.resolved_at ? (
        <span className="sub">
          Closed {short(r.resolved_at)}
          {r.resolved_note ? ': ' + r.resolved_note : ''}
        </span>
      ) : (
        <div className="btns">
          <button className="btn small ghost" onClick={() => setModal({ kind: 'resolve', report: r })}>
            Close report
          </button>
        </div>
      )}
    </section>
  );
}

export function LogPage({ d }) {
  return (
    <>
      <div className="page-head">
        <h1>Log</h1>
        <span className="sub">Every admin action, shop change and automatic action. Last 100.</span>
      </div>
      <section className="panel flush">
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Action</th>
                <th>Shop</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {d.audit.map((a, i) => (
                <tr key={i}>
                  <td>{dayOf(a.at)}</td>
                  <td className="name">{a.who || 'ShopDesk (automatic)'}</td>
                  <td>{a.action}</td>
                  <td className="name">{a.shop || ''}</td>
                  <td className="wrap">{a.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
