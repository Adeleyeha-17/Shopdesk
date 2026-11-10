// Announcements: a notice at the top of every vendor's app. Customers never see these.
import React, { useState } from 'react';
import { supabase } from '../lib/database.js';
import { errText } from '../lib/helpers.js';
import { short } from './adminHelpers.js';

// ---------- Announcements ----------
export function AnnouncementsPage({ d, say, load }) {
  const [v, setV] = useState({ title: '', body: '', days: '7' });
  const [err, setErr] = useState('');
  async function post() {
    const { error } = await supabase.rpc('admin_post_announcement', {
      p_title: v.title,
      p_body: v.body,
      p_days: parseInt(v.days, 10),
    });
    if (error) setErr(errText(error));
    else {
      setErr('');
      setV({ title: '', body: '', days: '7' });
      say('Posted. Vendors see it next time they open ShopDesk.');
      load();
    }
  }
  async function end(id) {
    const { error } = await supabase.rpc('admin_end_announcement', { p_id: id });
    if (error) say(errText(error));
    else {
      say('Ended.');
      load();
    }
  }
  return (
    <>
      <div className="page-head">
        <h1>Announcements</h1>
        <span className="sub">A notice at the top of every vendor's app. Customers never see these.</span>
      </div>
      <div className="grid2">
        <section className="panel">
          <div className="panel-head">
            <h3>New announcement</h3>
          </div>
          <div className="field">
            <label htmlFor="nTitle">Title</label>
            <input
              id="nTitle"
              value={v.title}
              maxLength={80}
              onChange={(e) => setV({ ...v, title: e.target.value })}
              placeholder="e.g. New: confirm payments faster"
            />
          </div>
          <div className="field">
            <label htmlFor="nBody">Message</label>
            <textarea
              id="nBody"
              value={v.body}
              maxLength={600}
              onChange={(e) => setV({ ...v, body: e.target.value })}
              placeholder="Keep it short. One or two sentences."
            />
          </div>
          <div className="field">
            <label htmlFor="nDays">Show it for</label>
            <select id="nDays" value={v.days} onChange={(e) => setV({ ...v, days: e.target.value })}>
              <option value="1">1 day</option>
              <option value="3">3 days</option>
              <option value="7">7 days</option>
              <option value="14">14 days</option>
              <option value="30">30 days</option>
              <option value="0">Until I end it</option>
            </select>
          </div>
          {err && <p className="err">{err}</p>}
          <div className="btns">
            <button className="btn small" onClick={post}>
              Post to all vendors
            </button>
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h3>Posted</h3>
          </div>
          {d.notices.length ? (
            <div className="rows">
              {d.notices.map((n) => (
                <div key={n.id} className="arow">
                  <span>
                    <strong>{n.title}</strong>{' '}
                    <span className={'chip ' + (n.live ? 'paid' : 'done')}>
                      {n.live ? 'Showing' : 'Ended'}
                    </span>
                    {n.body && <div className="sub wrap">{n.body}</div>}
                    <div className="sub">
                      Posted {short(n.created_at)}
                      {n.ends_at
                        ? ` · ${n.live ? 'ends' : 'ended'} ${short(n.ends_at)}`
                        : ' · until you end it'}
                    </div>
                  </span>
                  {n.live && (
                    <button className="btn small ghost" onClick={() => end(n.id)}>
                      End now
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="note">Nothing posted yet.</p>
          )}
        </section>
      </div>
    </>
  );
}
