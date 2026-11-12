// Admin > Invites: switch invites on or off, set the free months, and see every shop that came from an invite.
// While it's off, no shop sees "Invite a shop" and no free months are given.
import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/database.js';
import { dayOf } from '../lib/dates.js';
import { errText } from '../lib/helpers.js';

const MONTHS = [0, 1, 2, 3];
const label = (n) => (n === 0 ? 'Nothing' : n === 1 ? '1 free month' : `${n} free months`);

function where(r) {
  if (r.rewarded_at) return ['paid', 'Paying · reward given'];
  if (r.status === 'active') return r.paid ? ['paid', 'Paying'] : ['warn', 'Approved, not paying yet'];
  if (r.status === 'pending') return ['new', 'Waiting for approval'];
  return ['owe', r.status === 'rejected' ? 'Not approved' : 'Closed'];
}

export function InvitesPage({ say, go }) {
  const [d, setD] = useState(null);
  const [v, setV] = useState(null);
  const [err, setErr] = useState('');
  const load = useCallback(
    () =>
      supabase.rpc('admin_invites').then(({ data, error }) => {
        if (error) setErr(errText(error));
        else {
          setErr('');
          setD(data);
          setV((x) => x || data.settings);
        }
      }),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);
  async function save(part, done) {
    const { error } = await supabase.rpc('admin_save_settings', { p: part });
    if (error) {
      setErr(errText(error));
      return;
    }
    say(done);
    setV((x) => ({ ...x, ...part }));
    load();
  }
  if (!d || !v)
    return (
      <>
        <div className="page-head">
          <h1>Invites</h1>
        </div>
        {err ? <p className="err">{err}</p> : <p className="note">Loading…</p>}
      </>
    );
  const on = !!d.settings.invites_on;
  const rows = d.rows;
  const paying = rows.filter((r) => r.paid).length;
  const given = rows.filter((r) => r.rewarded_at).length;
  return (
    <>
      <div className="page-head">
        <h1>Invites</h1>
        <span className="sub">Shops bringing in shops, and the free months they earn.</span>
      </div>
      <section className="panel">
        <div className="switch-row">
          <div className="switch-text">
            <strong id="invitesOn">Show invites to shops</strong>
            <span className="sub">
              {on
                ? 'On: every approved shop sees "Invite a shop" on its Shop tab.'
                : 'Off: no shop sees "Invite a shop". Turn it on once shops can pay in the app.'}
            </span>
          </div>
          <span className="inv-state">{on ? 'On' : 'Off'}</span>
          <button
            type="button"
            role="switch"
            className="switch"
            aria-checked={on}
            aria-labelledby="invitesOn"
            onClick={() => save({ invites_on: !on }, on ? 'Invites are off.' : 'Invites are on.')}
          >
            <span />
          </button>
        </div>
      </section>
      {err && <p className="err">{err}</p>}
      <div className="grid2">
        <section className="panel">
          <div className="panel-head">
            <h3>The reward</h3>
          </div>
          <div className="form2">
            <div className="field">
              <label htmlFor="invGets">The shop that invites gets</label>
              <select
                id="invGets"
                value={v.invite_months}
                onChange={(e) => setV({ ...v, invite_months: +e.target.value })}
              >
                {MONTHS.map((n) => (
                  <option key={n} value={n}>
                    {label(n)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="invNew">The new shop gets</label>
              <select
                id="invNew"
                value={v.invited_months}
                onChange={(e) => setV({ ...v, invited_months: +e.target.value })}
              >
                {MONTHS.map((n) => (
                  <option key={n} value={n}>
                    {label(n)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="note">
            Given once, when you record the new shop&apos;s first paid month in Plans &amp; payments. Both plans move on
            by themselves.
          </p>
          <div className="btns">
            <button
              className="btn small"
              onClick={() =>
                save(
                  {
                    invite_months: v.invite_months,
                    invited_months: v.invited_months,
                  },
                  'Reward saved.',
                )
              }
            >
              Save reward
            </button>
          </div>
        </section>
        <div className="tiles">
          <div className="tile">
            <span className="label">Shops invited</span>
            <span className="big num">{rows.length}</span>
          </div>
          <div className="tile">
            <span className="label">Paying now</span>
            <span className="big num">{paying}</span>
          </div>
          <div className="tile">
            <span className="label">Rewards given</span>
            <span className="big num">{given}</span>
          </div>
        </div>
      </div>
      <section className="panel flush">
        <div className="panel-head pad">
          <h3>Every invite</h3>
        </div>
        {rows.length === 0 ? (
          <p className="note" style={{ padding: '0 20px 20px' }}>
            No shop has come from an invite yet.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>New shop</th>
                  <th>Invited by</th>
                  <th>Joined</th>
                  <th>Where they are</th>
                  <th>Reward</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const [tone, words] = where(r);
                  return (
                    <tr key={r.id} className="click" onClick={() => go('shop/' + r.id)}>
                      <td className="name">{r.name}</td>
                      <td className="name">{r.by}</td>
                      <td>{dayOf(r.joined)}</td>
                      <td>
                        <span className={'chip ' + tone}>{words}</span>
                      </td>
                      <td className={r.rewarded_at ? '' : 'sub'}>
                        {r.rewarded_at ? 'Given ' + dayOf(r.rewarded_at) : 'When they pay'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
