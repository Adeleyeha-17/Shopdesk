// Small helpers for the admin pages: status names, short dates, the plan label for a shop, and spreadsheet export.
import { DAY } from '../lib/dates.js';

export const STATUS = {
  pending: 'Waiting',
  active: 'Open',
  suspended: 'Suspended',
  banned: 'Closed for good',
  rejected: 'Not approved',
};

export const recent = (t, days) => t && Date.now() - new Date(t).getTime() < days * DAY;

export const short = (t) => new Date(t).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });

export const k = (n) =>
  n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'm' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n);

export const introMsg = (a) =>
  `Hi, this is ShopDesk. Thanks for signing up ${a.name}. Before we open your shop, please send a few photos or a short video of your stock, and tell us how long you've been selling.`;

export function downloadCsv(rows, name) {
  const esc = (v) => {
    const t = v == null ? '' : String(v);
    return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  };
  const text = rows.map((r) => r.map(esc).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv' }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
