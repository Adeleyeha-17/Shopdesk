// Records: nothing that leaves a shop's or customer's screen is lost. Find any order by its code (with its problem,
// refund receipt, reports and chat), and open the private copy of any shop that was deleted. Every look goes in the Log.
import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/database.js';
import { naira } from '../lib/money.js';
import { atText } from '../lib/dates.js';
import { errText } from '../lib/helpers.js';
import { PhotoStrip } from '../shared/OrderPhotos.jsx';
import { STATUS, short, downloadCsv } from './adminHelpers.js';
import { AdminOrder } from './AdminOrder.jsx';
import { BlockCustomer } from './BlockCustomer.jsx';

export function RecordsPage({ say }) {
  const [code, setCode] = useState('');
  const [found, setFound] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [archives, setArchives] = useState(null);
  const loadArchives = () => supabase.rpc('admin_archives').then(({ data }) => setArchives(data || []));
  useEffect(() => {
    loadArchives();
  }, []);
  async function find(e) {
    if (e) e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setErr('');
    const { data, error } = await supabase.rpc('admin_find_order', { p_code: code });
    setBusy(false);
    if (error) {
      setFound(null);
      setErr(errText(error));
    } else setFound(data);
  }
  return (
    <>
      <div className="page-head">
        <h1>Records</h1>
        <span className="sub">Every order, chat and deleted shop is kept. Each look goes in the Log.</span>
      </div>
      <section className="panel">
        <form className="inline" onSubmit={find}>
          <label htmlFor="findOrder" className="visually-hidden">
            Order code
          </label>
          <input
            id="findOrder"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Order code, like FG-24"
            autoComplete="off"
          />
          <button className="btn small" disabled={busy}>
            Find
          </button>
        </form>
        {err && <p className="err">{err}</p>}
      </section>
      {found && <Found f={found} say={say} reload={find} />}
      <section className="panel">
        <div className="panel-head">
          <h3>Deleted shops</h3>
          <span className="sub">A private copy of each, made before it was deleted.</span>
        </div>
        {archives === null ? (
          <p className="note">Loading…</p>
        ) : !archives.length ? (
          <p className="note">No shops have been deleted.</p>
        ) : (
          archives.map((a) => <Archive key={a.id} a={a} />)
        )}
      </section>
    </>
  );
}

function Found({ f, say, reload }) {
  const o = f.order;
  if (f.archive)
    return (
      <section className="panel">
        <div className="panel-head">
          <h3>
            {o.code} · {f.archive.shop} (deleted)
          </h3>
          <span className="sub">Deleted {short(f.archive.deleted_at)}</span>
        </div>
        <p className="sub">Why: {f.archive.reason}</p>
        <AdminOrder o={o} canChat={false} />
        <p className="note">Open the shop’s copy below for this order’s chat.</p>
      </section>
    );
  const p = f.problem;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>
          {o.code} · <a href={'#shop/' + f.shop.id}>{f.shop.name}</a>
        </h3>
        <span className="sub">{STATUS[f.shop.status] || f.shop.status}</span>
      </div>
      <div className="stack-sm">
        <span className="label">
          The customer · {f.customer.name}
          {f.customer.email ? ' · ' + f.customer.email : ''}
        </span>
        <BlockCustomer
          id={f.customer.id}
          name={f.customer.name}
          blocked={f.customer.blocked}
          after={(t) => {
            say(t);
            reload();
          }}
        />
      </div>
      <AdminOrder o={o} />
      {p && (
        <div className="slip">
          <span className="label">
            Problem · {p.kind} · {p.status.replace('_', ' ')}
          </span>
          <p className="problem-quote">“{p.details}”</p>
          <PhotoStrip paths={p.photos} label="Customer's photos" />
          {p.reply && (
            <span className="sub">
              Shop answered: {p.reply}
              {p.reply_note ? ` · “${p.reply_note}”` : ''}
            </span>
          )}
          <PhotoStrip paths={p.reply_photos} label="Shop's photos" />
          {p.decision && (
            <span className="sub">
              You decided {p.decision === 'customer' ? 'the customer was right' : 'the shop was right'}
              {p.decision_note ? `: ${p.decision_note}` : ''}
            </span>
          )}
          {p.owed_amount > 0 && (
            <span className="sub">
              Refund {naira(p.owed_amount)}
              {p.owed_sent_at ? ` · sent ${atText(p.owed_sent_at)}` : ''}
              {p.owed_disputed_at ? ` · customer said it didn’t arrive ${atText(p.owed_disputed_at)}` : ''}
              {p.owed_paid_at ? ` · closed (${p.owed_cleared_by}) ${atText(p.owed_paid_at)}` : ''}
            </span>
          )}
          {p.owed_receipt && <PhotoStrip paths={[p.owed_receipt]} label="Refund receipt" />}
        </div>
      )}
      {f.reports.map((r, i) => (
        <span className="sub" key={i}>
          Report ({r.about}) {short(r.created_at)}: “{r.reason}”
          {r.resolved_at ? ` · closed${r.resolved_note ? ': ' + r.resolved_note : ''}` : ' · open'}
        </span>
      ))}
    </section>
  );
}

// One deleted shop: download its copy (orders as a spreadsheet, or everything) after giving a reason.
function Archive({ a }) {
  const [open, setOpen] = useState(false);
  const [why, setWhy] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function get(kind) {
    setBusy(true);
    setErr('');
    const { data, error } = await supabase.rpc('admin_archive', { p_id: a.id, p_reason: why });
    setBusy(false);
    if (error) return setErr(errText(error));
    const name = `shopdesk-${a.slug}-deleted-${new Date(a.deleted_at).toISOString().slice(0, 10)}`;
    if (kind === 'csv') {
      const rows = [
        ['Order', 'Date', 'Customer', 'Items', 'Total', 'Paid', 'Status', 'Why cancelled', 'Chat'],
        ...(data.orders || []).map((o) => [
          o.code,
          o.created_at,
          o.customer_name,
          (o.items || []).map((i) => `${i.qty} x ${i.name}`).join(', '),
          o.items_total + (o.delivery_paid_by === 'customer' ? o.delivery_fee || 0 : 0),
          o.amount_paid,
          o.status,
          o.cancel_text || '',
          (o.chat || []).map((m) => `[${m.created_at.slice(0, 16)} ${m.sender}] ${m.body}`).join('\n'),
        ]),
      ];
      downloadCsv(rows, name + '.csv');
    } else {
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = name + '.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
    setOpen(false);
  }
  return (
    <div className="slip">
      <div className="row">
        <strong>
          {a.shop} <span className="sub">/{a.slug}</span>
        </strong>
        <span className="sub">{short(a.deleted_at)}</span>
      </div>
      <span className="sub">
        {[a.email, a.by ? 'deleted by ' + a.by : 'deleted with its account', `${a.orders} orders`]
          .filter(Boolean)
          .join(' · ')}
      </span>
      <span className="sub">Why: {a.reason}</span>
      {open ? (
        <div className="stack-sm">
          <div className="field">
            <label htmlFor={'arc' + a.id}>Why are you opening it? (goes in the Log)</label>
            <input id={'arc' + a.id} value={why} onChange={(e) => setWhy(e.target.value)} maxLength={200} />
          </div>
          {err && <p className="err">{err}</p>}
          <div className="btns">
            <button className="btn small" disabled={busy || why.trim().length < 5} onClick={() => get('csv')}>
              Orders and chats (spreadsheet)
            </button>
            <button
              className="btn small ghost"
              disabled={busy || why.trim().length < 5}
              onClick={() => get('json')}
            >
              Everything (file)
            </button>
          </div>
        </div>
      ) : (
        <div className="btns">
          <button className="linkbtn" onClick={() => setOpen(true)}>
            Download the copy
          </button>
        </div>
      )}
    </div>
  );
}
