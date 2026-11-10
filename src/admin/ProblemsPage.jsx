// Problems: what customers reported about their orders, the shop's answer, and your decision.
// Waiting for you first (the customer asked, or the shop didn't answer in 48 hours), then ones still between
// the shop and the customer, then the ones closed in the last 30 days.
// The customer's email and phone show only once a problem is with you. When the customer was right you can set a refund:
// the shop has 48 hours to pay it or its page pauses until the customer confirms (you can also clear it yourself).
import React, { useState } from 'react';
import { supabase } from '../lib/database.js';
import { atText } from '../lib/dates.js';
import { errText, waLink } from '../lib/helpers.js';
import { naira, toInt } from '../lib/money.js';
import { kick } from '../lib/alerts.js';
import { kindText, replyText } from '../lib/problems.js';
import { PhotoStrip } from '../shared/OrderPhotos.jsx';
import { BlockCustomer } from './BlockCustomer.jsx';
import { AdminOrder } from './AdminOrder.jsx';

const STATE = {
  with_shopdesk: ['owe', 'Waiting for you'],
  open: ['warn', 'Waiting for the shop'],
  answered: ['new', 'Waiting for the customer'],
  sorted: ['paid', 'Sorted between them'],
  decided: ['done', 'Decided'],
};

function Decide({ p, load, say }) {
  const [note, setNote] = useState('');
  const [owed, setOwed] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function decide(who) {
    if (note.trim().length < 5) return setErr('Write your decision first.');
    const amount = who === 'customer' && owed.trim() ? toInt(owed) : null;
    if (who === 'customer' && owed.trim() && !amount) return setErr('Enter the refund in naira, e.g. 8000.');
    setBusy(true);
    setErr('');
    const { error } = await supabase.rpc('admin_decide_problem', {
      p_problem: p.id,
      p_decision: who,
      p_note: note,
      p_owed: amount,
    });
    setBusy(false);
    if (error) return setErr(errText(error));
    say(
      `Decided ${p.order.code}.` + (amount ? ` ${p.shop.name} has 48 hours to refund ${naira(amount)}.` : ''),
    );
    kick();
    load();
  }
  return (
    <div className="stack-sm">
      <div className="field">
        <label htmlFor={'dn' + p.id}>Your decision (both sides see it)</label>
        <textarea
          id={'dn' + p.id}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={600}
          placeholder="e.g. The packing photo shows one pan. Refund the second pan."
        />
      </div>
      <div className="field">
        <label htmlFor={'do' + p.id}>Refund the customer (₦, optional)</label>
        <input
          id={'do' + p.id}
          inputMode="numeric"
          value={owed}
          onChange={(e) => setOwed(e.target.value)}
          placeholder={
            'up to ' +
            naira(
              Math.max(
                p.order.amount_paid,
                p.order.items_total +
                  (p.order.delivery_paid_by === 'customer' ? p.order.delivery_fee || 0 : 0),
              ),
            )
          }
        />
        <span className="sub">
          Only with "The customer was right". The shop has 48 hours or its page pauses.
        </span>
      </div>
      {err && <p className="err">{err}</p>}
      <div className="btns">
        <button className="btn small" onClick={() => decide('customer')} disabled={busy}>
          The customer was right
        </button>
        <button className="btn small ghost" onClick={() => decide('shop')} disabled={busy}>
          The shop was right
        </button>
      </div>
    </div>
  );
}

// A refund you set: waiting, sent, confirmed, or cleared by you.
function Owed({ p, load, say }) {
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState('');
  if (!p.owed_amount) return null;
  const late = !p.owed_paid_at && new Date(p.owed_by) < new Date();
  async function clear() {
    const { error } = await supabase.rpc('admin_clear_owed', { p_problem: p.id, p_note: note });
    if (error) return setErr(errText(error));
    say('Refund cleared. The shop takes orders again.');
    load();
  }
  return (
    <div className="slip">
      <span className="label">
        Refund {naira(p.owed_amount)} ·{' '}
        {p.owed_paid_at
          ? p.owed_cleared_by === 'admin'
            ? 'cleared by you'
            : p.owed_cleared_by === 'auto'
              ? 'counted as received (no answer in 48 hours)'
              : 'customer confirmed'
          : p.owed_disputed_at
            ? 'customer says it didn’t arrive'
            : late && !p.owed_sent_at
              ? 'overdue, shop page paused'
              : 'due ' + atText(p.owed_by)}
      </span>
      {p.owed_sent_at && (
        <span className="sub">
          The shop says it sent it {atText(p.owed_sent_at)}.
          {p.owed_disputed_at ? ` The customer said it didn’t arrive ${atText(p.owed_disputed_at)}.` : ''}
        </span>
      )}
      {p.owed_receipt && <PhotoStrip paths={[p.owed_receipt]} label="The shop's receipt" />}
      {!p.owed_paid_at &&
        (open ? (
          <>
            <div className="field">
              <label htmlFor={'co' + p.id}>Why clear it? (audit log)</label>
              <input id={'co' + p.id} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            {err && <p className="err">{err}</p>}
            <div className="btns">
              <button className="btn small" onClick={clear}>
                Clear refund
              </button>
              <button className="btn small ghost" onClick={() => setOpen(false)}>
                Back
              </button>
            </div>
          </>
        ) : (
          <div className="btns">
            <button className="linkbtn" onClick={() => setOpen(true)}>
              Clear it myself
            </button>
          </div>
        ))}
    </div>
  );
}

function ProblemCard({ p, load, say }) {
  const [tone, label] = STATE[p.status] || ['', p.status];
  const o = p.order;
  const open = !['sorted', 'decided'].includes(p.status);
  return (
    <section className={'panel' + (p.status === 'with_shopdesk' ? ' hot' : '')}>
      <div className="panel-head">
        <h3>
          {o.code} · <a href={'#shop/' + p.shop.id}>{p.shop.name}</a> · {kindText(p.kind)}
        </h3>
        <span className={'chip ' + tone}>{label}</span>
      </div>
      <p className="sub">
        Reported {atText(p.created_at)}
        {p.status === 'with_shopdesk' &&
          (p.escalated_by === 'no_reply' ? ' · no answer in 48 hours' : ' · the customer asked you')}
        {p.status === 'open' && ` · the shop has until ${atText(p.reply_by)}`}
      </p>
      <div className="two-col">
        <div className="stack-sm">
          <span className="label">The customer · {p.customer.name}</span>
          {(p.customer.email || p.customer.phone) && (
            <span className="sub">{[p.customer.email, p.customer.phone].filter(Boolean).join(' · ')}</span>
          )}
          {p.customer.rejected_90d >= 2 && (
            <span className="chip warn">{p.customer.rejected_90d} complaints rejected in 90 days</span>
          )}
          <BlockCustomer
            id={p.customer.id}
            name={p.customer.name}
            blocked={p.customer.blocked}
            after={(t) => {
              say(t);
              load();
            }}
          />
          <p className="problem-quote">“{p.details}”</p>
          <PhotoStrip paths={p.photos} label="Customer's photos" />
          {p.refund_received_at && (
            <span className="sub">Confirmed the refund arrived, {atText(p.refund_received_at)}.</span>
          )}
        </div>
        <div className="stack-sm">
          <span className="label">The shop</span>
          {p.shop.upheld_30d >= 3 && (
            <span className="chip owe">{p.shop.upheld_30d} complaints upheld in 30 days</span>
          )}
          {p.reply ? (
            <>
              <strong>{replyText(p)}</strong>
              {p.reply_note && <p className="problem-quote">“{p.reply_note}”</p>}
              <PhotoStrip paths={p.reply_photos} label="Shop's photos" />
              <span className="sub">Answered {atText(p.answered_at)}</span>
            </>
          ) : (
            <p className="note">No answer yet.</p>
          )}
          {p.shop.whatsapp && (
            <a
              className="btn small ghost"
              href={waLink(p.shop.whatsapp, `Hi ${p.shop.name}, this is ShopDesk about order ${o.code}: `)}
              target="_blank"
              rel="noopener"
            >
              Message the shop
            </a>
          )}
        </div>
      </div>
      <AdminOrder o={o} canChat={['with_shopdesk', 'decided'].includes(p.status)} />
      {p.status === 'decided' && (
        <p className="note">
          <strong>
            You decided {p.decision === 'customer' ? 'the customer was right' : 'the shop was right'}:
          </strong>{' '}
          {p.decision_note}
        </p>
      )}
      <Owed p={p} load={load} say={say} />
      {open && <Decide p={p} load={load} say={say} />}
    </section>
  );
}

export function ProblemsPage({ d, load, say }) {
  const [show, setShow] = useState('you');
  const all = d.problems || [];
  const groups = {
    you: all.filter((p) => p.status === 'with_shopdesk'),
    open: all.filter((p) => ['open', 'answered'].includes(p.status)),
    closed: all.filter((p) => ['sorted', 'decided'].includes(p.status)),
    refunds: all.filter((p) => p.owed_amount && !p.owed_paid_at),
  };
  return (
    <>
      <div className="page-head">
        <h1>Problems</h1>
        <span className="sub">The shop has 48 hours to answer. Then it's sorted, or it comes to you.</span>
      </div>
      <div className="filters" role="group" aria-label="Show">
        {[
          ['you', 'Waiting for you'],
          ['open', 'Between them'],
          ['refunds', 'Refunds due'],
          ['closed', 'Closed (30 days)'],
        ].map(([k, l]) => (
          <button key={k} className="filter" aria-pressed={show === k} onClick={() => setShow(k)}>
            {l} ({groups[k].length})
          </button>
        ))}
      </div>
      {groups[show].length ? (
        groups[show].map((p) => <ProblemCard key={p.id} p={p} load={load} say={say} />)
      ) : (
        <section className="panel">
          <p className="note">{show === 'you' ? 'Nothing is waiting for you.' : 'None here.'}</p>
        </section>
      )}
    </>
  );
}
