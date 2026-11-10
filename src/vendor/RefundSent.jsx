// A refund ShopDesk ordered: the shop sends the money, then adds a photo of the transfer receipt. The customer and
// ShopDesk see the receipt. While the customer checks, the shop's page stays open; no answer in 48 hours counts as
// received. If the customer says it didn't arrive, the page pauses again until they confirm or ShopDesk decides.
import React, { useState } from 'react';
import { atText, DAY } from '../lib/dates.js';
import { errText } from '../lib/helpers.js';
import { naira } from '../lib/money.js';
import { uploadOrderPhoto } from '../lib/photos.js';
import { PhotoStrip } from '../shared/OrderPhotos.jsx';

// Where the refund stands, in a line.
export function refundLine(p, who) {
  if (p.owed_disputed_at) return `${who} says it didn't arrive. ShopDesk is checking.`;
  if (p.owed_sent_at)
    return `Sent. ${who} has until ${atText(new Date(new Date(p.owed_sent_at).getTime() + 2 * DAY))} to say if it didn't arrive.`;
  return '';
}

export function RefundSent({ p, who, run, say, link = false }) {
  const [busy, setBusy] = useState(false);
  async function send(file) {
    if (!file) return;
    setBusy(true);
    try {
      const path = await uploadOrderPhoto(p.order_id, 'r', file);
      await run(
        'refund_sent',
        { p_order: p.order_id, p_receipt: path },
        `${who} is told. They confirm when it lands.`,
      );
    } catch (e) {
      if (say) say(errText(e));
    }
    setBusy(false);
  }
  const id = 'refund-' + p.id + (link ? '-b' : '');
  const label = busy
    ? 'Sending…'
    : p.owed_sent_at
      ? 'Add another receipt'
      : `I've sent ${naira(p.owed_amount)}: add the receipt`;
  return (
    <>
      {p.owed_receipt && <PhotoStrip paths={[p.owed_receipt]} label="Your receipt" />}
      {(!p.owed_sent_at || p.owed_disputed_at) && (
        <div className="btns">
          <label className={link ? 'linkbtn' : 'btn small'} htmlFor={id} aria-disabled={busy}>
            {label}
          </label>
          <input
            id={id}
            type="file"
            accept="image/*"
            className="visually-hidden"
            disabled={busy}
            onChange={(e) => {
              send(e.target.files && e.target.files[0]);
              e.target.value = '';
            }}
          />
        </div>
      )}
    </>
  );
}
