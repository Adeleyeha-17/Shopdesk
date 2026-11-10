// The customer's side of a problem with an order ("confirm or complain").
//   ReportProblemForm: what went wrong, a sentence or two, and up to 3 photos (one is needed for a wrong, damaged or
//                      missing item).
//   CustomerProblem:   where it stands, the shop's answer, and what the customer can do next. A refund the shop says it
//                      sent comes with its receipt; the customer says it arrived or didn't (no answer in 48 hours counts
//                      as arrived, and they can still say it didn't for 7 days).
import React, { useState } from 'react';
import { supabase } from '../lib/database.js';
import { atText, DAY } from '../lib/dates.js';
import { errText } from '../lib/helpers.js';
import { naira } from '../lib/money.js';
import { kick } from '../lib/alerts.js';
import { uploadOrderPhoto } from '../lib/photos.js';
import { KINDS, kindText, replyText } from '../lib/problems.js';
import { PhotoStrip, PhotoPicker } from '../shared/OrderPhotos.jsx';

const NEEDS_PHOTO = ['wrong_item', 'damaged', 'missing_item'];

export function ReportProblemForm({ orderId, token, late, onDone, onCancel }) {
  const [kind, setKind] = useState(late ? 'not_arrived' : '');
  const [details, setDetails] = useState('');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function send() {
    if (!kind) return setErr('Choose what went wrong.');
    if (details.trim().length < 10) return setErr('Say what happened.');
    if (NEEDS_PHOTO.includes(kind) && !files.length) return setErr('Add a photo of what you got.');
    setBusy(true);
    setErr('');
    try {
      const paths = [];
      for (const f of files) paths.push(await uploadOrderPhoto(orderId, 'c', f));
      const { error } = await supabase.rpc('report_problem', {
        p_token: token,
        p_kind: kind,
        p_details: details,
        p_photos: paths,
      });
      if (error) throw error;
      onDone();
    } catch (e) {
      setErr(errText(e));
    }
    setBusy(false);
  }
  return (
    <section className="card boxed">
      <h2>Report a problem</h2>
      <p className="note">The shop has 48 hours to answer. If you can't agree, ShopDesk decides.</p>
      <div className="choices" role="radiogroup" aria-label="What went wrong?">
        {KINDS.map(([k, label]) => (
          <button
            key={k}
            type="button"
            className="choice"
            role="radio"
            aria-checked={kind === k}
            onClick={() => setKind(k)}
          >
            <strong>{label}</strong>
            <i aria-hidden="true" />
          </button>
        ))}
      </div>
      <div className="field">
        <label htmlFor="pDetails">What happened?</label>
        <textarea
          id="pDetails"
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          maxLength={600}
          placeholder="e.g. I ordered two pans and got one."
        />
      </div>
      <PhotoPicker
        id="pPhotos"
        files={files}
        setFiles={setFiles}
        label={NEEDS_PHOTO.includes(kind) ? 'Photo of what you got' : 'Photos (optional)'}
      />
      <p className="note" style={{ fontSize: 12 }}>
        Be honest. False reports can pause reporting on your account.
      </p>
      {err && <p className="err">{err}</p>}
      <div className="btns">
        <button className="btn" onClick={send} disabled={busy}>
          {busy ? 'Sending…' : 'Send to the shop'}
        </button>
        <button className="btn ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </section>
  );
}

function chipFor(p) {
  if (p.status === 'open') return ['warn', 'Waiting for the shop'];
  if (p.status === 'answered') return ['new', 'The shop answered'];
  if (p.status === 'with_shopdesk') return ['warn', 'With ShopDesk'];
  if (p.status === 'sorted') return ['paid', 'Sorted'];
  return p.decision === 'customer' ? ['paid', 'Decided · you were right'] : ['done', 'Decided'];
}

export function CustomerProblem({ p, token, reload, setMsg }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const chip = chipFor(p);
  async function act(action, done) {
    setBusy(true);
    setErr('');
    const { error } = await supabase.rpc('problem_customer', { p_token: token, p_action: action });
    setBusy(false);
    if (error) setErr(errText(error));
    else {
      setMsg(done);
      kick();
      reload();
    }
  }
  const escalate = (
    <button className="btn ghost" onClick={() => act('escalate', 'ShopDesk will decide.')} disabled={busy}>
      Ask ShopDesk to decide
    </button>
  );
  return (
    <section className="card boxed problem">
      <div className="row">
        <span className="label">Your problem report · {kindText(p.kind)}</span>
        <span className={'chip ' + chip[0]}>{chip[1]}</span>
      </div>
      <p className="problem-quote">“{p.details}”</p>
      <PhotoStrip paths={p.photos} label="Your photos" />
      <span className="sub">Sent {atText(p.created_at)}</span>

      {p.status === 'open' && (
        <p className="note">
          The shop has until <strong>{atText(p.reply_by)}</strong> to answer.
        </p>
      )}

      {p.reply && (
        <div className="slip">
          <span className="label">The shop answered · {replyText(p)}</span>
          {p.reply_note && <span>“{p.reply_note}”</span>}
          <PhotoStrip paths={p.reply_photos} label="The shop's photos" />
        </div>
      )}

      {p.status === 'answered' && p.reply === 'refund' && (
        <>
          <p className="note">Did the money arrive?</p>
          <div className="btns">
            <button className="btn" onClick={() => act('refund_received', 'Thanks. Closed.')} disabled={busy}>
              The refund arrived
            </button>
            {escalate}
          </div>
        </>
      )}
      {p.status === 'answered' && p.reply === 'resend' && (
        <>
          <p className="note">
            The shop is sending it again. Tap <strong>I got everything</strong> when it arrives.
          </p>
          <div className="btns">{escalate}</div>
        </>
      )}
      {p.status === 'answered' && p.reply === 'explain' && (
        <div className="btns">
          <button className="btn" onClick={() => act('sorted', 'Thanks. Closed.')} disabled={busy}>
            It's sorted
          </button>
          {escalate}
        </div>
      )}
      {p.status === 'with_shopdesk' && (
        <>
          <p className="note">
            {p.escalated_by === 'no_reply' ? "The shop didn't answer, so " : ''}ShopDesk is deciding. You'll
            see it here.
          </p>
          <div className="btns">
            <button className="linkbtn" onClick={() => act('sorted', 'Thanks. Closed.')} disabled={busy}>
              It's sorted now
            </button>
          </div>
        </>
      )}
      {p.status === 'sorted' && (
        <p className="note">
          {p.refund_received_at ? `Sorted. Refund arrived ${atText(p.refund_received_at)}.` : 'Sorted.'}
        </p>
      )}
      {p.status === 'decided' && (
        <p className="note">
          <strong>
            ShopDesk decided {p.decision === 'customer' ? 'you were right' : 'the shop was right'}:
          </strong>{' '}
          {p.decision_note}
        </p>
      )}
      {p.owed_amount > 0 && <OwedSlip p={p} act={act} busy={busy} />}
      {err && <p className="err">{err}</p>}
    </section>
  );
}

// A refund ShopDesk ordered the shop to pay.
function OwedSlip({ p, act, busy }) {
  const arrived = (
    <button className="btn small" onClick={() => act('refund_received', 'Thanks. Closed.')} disabled={busy}>
      It arrived
    </button>
  );
  const missing = (
    <button
      className="btn small ghost"
      onClick={() => act('refund_missing', 'ShopDesk will check with the shop.')}
      disabled={busy}
    >
      It didn't arrive
    </button>
  );
  if (p.owed_paid_at) {
    const late = p.owed_cleared_by === 'auto' && new Date(p.owed_paid_at) > new Date(Date.now() - 7 * DAY);
    return (
      <div className="slip">
        <span className="sub">
          {p.owed_cleared_by === 'admin'
            ? `ShopDesk closed the ${naira(p.owed_amount)} refund.`
            : p.owed_cleared_by === 'auto'
              ? `Refund of ${naira(p.owed_amount)} counted as arrived (no answer in 2 days).`
              : `Refund of ${naira(p.owed_amount)} arrived.`}
        </span>
        {late && <div className="btns">{missing}</div>}
      </div>
    );
  }
  return (
    <div className="slip">
      <span className="label">
        The shop must refund {naira(p.owed_amount)} by {atText(p.owed_by)}
      </span>
      {p.owed_receipt && <PhotoStrip paths={[p.owed_receipt]} label="The shop's receipt" />}
      <span className="sub">
        {p.owed_disputed_at
          ? 'You said it didn’t arrive. ShopDesk is checking.'
          : p.owed_sent_at
            ? `The shop says it’s sent. Check your bank. No answer by ${atText(
                new Date(new Date(p.owed_sent_at).getTime() + 2 * DAY),
              )} counts as arrived.`
            : 'Tap when it arrives.'}
      </span>
      <div className="btns">
        {arrived}
        {p.owed_sent_at && !p.owed_disputed_at && missing}
      </div>
    </div>
  );
}
