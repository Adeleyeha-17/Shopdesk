// A problem the customer reported, inside the order on the Orders tab. The shop has 48 hours to answer:
//   Refund        -> send the money back from your bank app, then record how much
//   Send it again -> the order goes back to packing, then to a rider
//   Explain       -> your side, with photos if they help (your packing photo is the best proof)
// Then the customer says it's sorted, or asks ShopDesk to decide. If ShopDesk orders a refund, the shop has 48 hours
// to pay it (and taps "I've sent it"), or its page pauses until the customer confirms.
import React, { useState } from 'react';
import { naira, toInt } from '../lib/money.js';
import { atText } from '../lib/dates.js';
import { errText } from '../lib/helpers.js';
import { uploadOrderPhoto } from '../lib/photos.js';
import { kindText, problemState, replyBy, replyText } from '../lib/problems.js';
import { RefundSent, refundLine } from './RefundSent.jsx';
import { PhotoStrip, PhotoPicker } from '../shared/OrderPhotos.jsx';

function chipFor(p, st) {
  if (st === 'open') return ['owe', 'Answer by ' + atText(replyBy(p))];
  if (st === 'answered') return ['new', 'Waiting for the customer'];
  if (st === 'with_shopdesk') return ['warn', 'With ShopDesk'];
  if (st === 'sorted') return ['paid', 'Sorted'];
  return p.decision === 'shop'
    ? ['paid', 'Decided · you were right']
    : ['owe', 'Decided · customer was right'];
}

export function ProblemPanel({ o, p, code, run, say }) {
  const st = problemState(p);
  const [mode, setMode] = useState(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [files, setFiles] = useState([]);
  const [usePack, setUsePack] = useState(false);
  const [busy, setBusy] = useState(false);
  const canAnswer = !p.reply && (st === 'open' || st === 'with_shopdesk');
  const chip = chipFor(p, st);

  async function send() {
    if (mode === 'refund' && toInt(amount) == null) {
      say('Enter the amount, e.g. 3000.');
      return;
    }
    if (mode === 'explain' && note.trim().length < 10) {
      say('Say what happened.');
      return;
    }
    setBusy(true);
    try {
      const paths = [];
      for (const f of files) paths.push(await uploadOrderPhoto(o.id, 'v', f));
      if (usePack && o.packing_photo) paths.unshift(o.packing_photo);
      const done = {
        refund: 'Refund recorded. The customer confirms when it lands.',
        resend: `${code} is back in packing.`,
        explain: 'Answer sent.',
      }[mode];
      const ok = await run(
        'answer_problem',
        {
          p_order: o.id,
          p_reply: mode,
          p_note: note,
          p_refund: mode === 'refund' ? toInt(amount) : null,
          p_photos: paths.slice(0, 3),
        },
        done,
      );
      if (ok) setMode(null);
    } catch (e) {
      say(errText(e));
    }
    setBusy(false);
  }

  return (
    <div className={'problem' + (st === 'open' ? ' urgent' : '')}>
      <div className="row">
        <span className="label">Problem reported · {kindText(p.kind)}</span>
        <span className={'chip ' + chip[0]}>{chip[1]}</span>
      </div>
      <p className="problem-quote">“{p.details}”</p>
      <PhotoStrip paths={p.photos} label="The customer's photos" />
      <span className="sub">Reported {atText(p.created_at)}</span>

      {st === 'open' && !p.reply && (
        <p className="note">
          <strong>Answer by {atText(replyBy(p))}</strong> or ShopDesk decides.
        </p>
      )}
      {st === 'with_shopdesk' && !p.reply && (
        <p className="note">
          <strong>ShopDesk is deciding.</strong> You can still give your side.
        </p>
      )}

      {canAnswer && !mode && (
        <div className="btns">
          <button className="btn small" onClick={() => setMode('refund')}>
            Refund
          </button>
          <button className="btn small ghost" onClick={() => setMode('resend')}>
            Send it again
          </button>
          <button className="btn small ghost" onClick={() => setMode('explain')}>
            Explain
          </button>
        </div>
      )}

      {canAnswer && mode && (
        <div className="stack-sm">
          {mode === 'refund' && (
            <>
              <p className="note">Send it from your bank app first. They paid {naira(o.amount_paid)}.</p>
              <div className="field">
                <label htmlFor={'ra' + o.id}>How much did you send back? (₦)</label>
                <input
                  id={'ra' + o.id}
                  inputMode="numeric"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={'e.g. ' + o.amount_paid}
                />
              </div>
            </>
          )}
          {mode === 'resend' && <p className="note">It goes back to packing, then to a rider.</p>}
          <div className="field">
            <label htmlFor={'rn-' + o.id}>
              {mode === 'explain' ? 'What happened?' : 'Message for the customer (optional)'}
            </label>
            <textarea
              id={'rn-' + o.id}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={600}
              placeholder={
                mode === 'explain'
                  ? 'e.g. It left the shop sealed and complete. See the packing photo.'
                  : mode === 'resend'
                    ? 'e.g. Sending the right size today, with Musa.'
                    : 'e.g. Sorry about this. I sent ₦3,000 back to your bank.'
              }
            />
          </div>
          {mode === 'explain' && (
            <>
              {o.packing_photo && (
                <label className="pack">
                  <input type="checkbox" checked={usePack} onChange={(e) => setUsePack(e.target.checked)} />
                  <span>Include my packing photo</span>
                </label>
              )}
              <PhotoPicker
                id={'rp-' + o.id}
                files={files}
                setFiles={setFiles}
                max={usePack ? 2 : 3}
                label="More photos (optional)"
              />
            </>
          )}
          <div className="btns">
            <button className="btn small" onClick={send} disabled={busy}>
              {busy ? 'Sending…' : 'Send answer'}
            </button>
            <button className="btn small ghost" onClick={() => setMode(null)} disabled={busy}>
              Back
            </button>
          </div>
        </div>
      )}

      {p.reply && (
        <div className="slip">
          <span className="label">You answered · {replyText(p)}</span>
          {p.reply_note && <span>“{p.reply_note}”</span>}
          <PhotoStrip paths={p.reply_photos} label="Your photos" />
        </div>
      )}
      {st === 'answered' && <p className="note">Waiting for the customer.</p>}
      {st === 'with_shopdesk' && p.reply && (
        <p className="note">
          {p.escalated_by === 'customer'
            ? 'The customer asked ShopDesk to decide.'
            : 'ShopDesk is deciding (answered after 48 hours).'}
        </p>
      )}
      {st === 'sorted' && (
        <p className="note">
          {p.refund_received_at
            ? `Refund confirmed, ${atText(p.refund_received_at)}.`
            : 'Customer says it’s sorted.'}
        </p>
      )}
      {st === 'decided' && (
        <p className="note">
          <strong>
            ShopDesk decided {p.decision === 'shop' ? 'your shop was right' : 'the customer was right'}:
          </strong>{' '}
          {p.decision_note}
        </p>
      )}
      {p.owed_amount > 0 &&
        (p.owed_paid_at ? (
          <p className="note">
            Refund of {naira(p.owed_amount)}{' '}
            {p.owed_cleared_by === 'auto'
              ? 'counted as received.'
              : p.owed_cleared_by === 'admin'
                ? 'closed by ShopDesk.'
                : 'confirmed.'}
          </p>
        ) : (
          <div className="slip">
            <span className="label">
              Refund {naira(p.owed_amount)} by {atText(p.owed_by)}
            </span>
            <span className="sub">
              {p.owed_sent_at ? refundLine(p, 'The customer') : "Or your shop page pauses until it's paid."}
            </span>
            <RefundSent p={p} who="The customer" run={run} say={say} />
          </div>
        ))}
    </div>
  );
}
