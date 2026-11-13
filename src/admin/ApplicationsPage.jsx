// Applications: new shops waiting for you to vet and approve.
import React from 'react';
import { dayOf } from '../lib/dates.js';
import { photoUrl } from '../lib/photos.js';
import { introMsg } from './adminHelpers.js';

// ---------- Applications ----------
export function ApplicationsPage({ d, setModal }) {
  const apps = d.o.applications || [];
  return (
    <>
      <div className="page-head">
        <h1>Applications</h1>
        <span className="sub">New shops stay closed to customers until you approve them.</span>
      </div>
      <p className="note" style={{ maxWidth: 760 }}>
        Before approving: message them, ask for stock photos, check their Instagram, and check the account
        name fits.
      </p>
      {!apps.length && (
        <section className="panel">
          <p className="note">No shops waiting.</p>
        </section>
      )}
      <div className="cards">
        {apps.map((a) => (
          <section key={a.id} className="panel app-row">
            <div>
              <h3 style={{ margin: 0 }}>{a.name}</h3>
              <span className="sub">
                /{a.slug} · applied {dayOf(a.created_at)} · {a.owner_email}
              </span>
            </div>
            <dl className="kv">
              <dt>Sells</dt>
              <dd>{a.sells || 'Not given'}</dd>
              <dt>Based in</dt>
              <dd>{a.location || 'Not given'}</dd>
              <dt>Instagram/TikTok</dt>
              <dd>{a.social || 'None'}</dd>
              <dt>WhatsApp</dt>
              <dd>{a.whatsapp || 'None'}</dd>
              <dt>Paid into</dt>
              <dd>
                {a.bank} · {a.account_number} · {a.account_name}
              </dd>
              <dt>Products</dt>
              <dd>{a.products ? `${a.products} added` : 'None yet'}</dd>
            </dl>
            {a.photos.length > 0 && (
              <div className="thumbs">
                {a.photos.map((ph) => (
                  <img key={ph} src={photoUrl(ph)} alt="" loading="lazy" />
                ))}
              </div>
            )}
            <div className="btns">
              <button
                className="btn small ghost"
                onClick={() => setModal({ kind: 'message', shop: { ...a, status: 'pending' }, text: introMsg(a) })}
              >
                Message
              </button>
              <button className="btn small" onClick={() => setModal({ kind: 'approve', shop: a })}>
                Approve
              </button>
              <button className="btn small ghost" onClick={() => setModal({ kind: 'reject', shop: a })}>
                Don't approve
              </button>
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
