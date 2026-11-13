// The shop details form (name, link, bank account, WhatsApp, what you sell, where you are),
// used when a vendor sets up their shop and again on the Shop tab.
import React from 'react';
import { slugify } from '../lib/helpers.js';

// Where customers pay. Named banks can take online payments (Paystack pays the shop's account); "Other bank" can't.
// The money server function matches these names to Paystack's bank list (supabase/functions/money), so keep the two in step.
export const POPULAR_BANKS = ['OPay', 'Moniepoint', 'Kuda', 'PalmPay'];
export const OTHER_BANKS = [
  'Access Bank',
  'Carbon',
  'Citibank',
  'Ecobank',
  'FairMoney',
  'FCMB',
  'Fidelity Bank',
  'First Bank',
  'Globus Bank',
  'GTBank',
  'Jaiz Bank',
  'Keystone Bank',
  'Lotus Bank',
  'Optimus Bank',
  'Paga',
  'Parallex Bank',
  'Polaris Bank',
  'PremiumTrust Bank',
  'Providus Bank',
  'Signature Bank',
  'Stanbic IBTC',
  'Standard Chartered',
  'Sterling Bank',
  'SunTrust Bank',
  'TAJ Bank',
  'Titan Trust Bank',
  'UBA',
  'Union Bank',
  'Unity Bank',
  'VFD',
  'Wema Bank',
  'Zenith Bank',
];
export const BANKS = [...POPULAR_BANKS, ...OTHER_BANKS, 'Other bank'];

// While the link name is being typed, a dash at the end stays, so "rose-perfumes" can be typed letter by letter.
// It is tidied (no dash at either end) for the preview, the check and the save.
const slugTyping = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 30);
const cleanSlug = (s) => String(s || '').replace(/-+$/, '');

export function ShopFields({ v, set }) {
  const f = (k) => (e) => set({ ...v, [k]: e.target.value });
  return (
    <>
      <div className="field">
        <label htmlFor="sName">Business name</label>
        <input
          id="sName"
          value={v.name}
          onChange={(e) => set({ ...v, name: e.target.value, slug: v.slugTouched ? v.slug : slugify(e.target.value) })}
          placeholder="e.g. Rose's Perfumes"
        />
      </div>
      <div className="field">
        <label htmlFor="sSlug">Your link name</label>
        <input
          id="sSlug"
          value={v.slug}
          onChange={(e) => set({ ...v, slug: slugTyping(e.target.value), slugTouched: true })}
          placeholder="e.g. rosesperfumes"
        />
        <span className="sub">
          {window.location.host}/{cleanSlug(v.slug) || 'yourshop'}
        </span>
      </div>
      <div className="field">
        <label htmlFor="sBank">Where customers pay</label>
        <select id="sBank" value={v.bank} onChange={f('bank')}>
          <optgroup label="Most used">
            {POPULAR_BANKS.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </optgroup>
          <optgroup label="Banks">
            {OTHER_BANKS.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </optgroup>
          <option>Other bank</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="sNum">Account number</label>
        <input id="sNum" inputMode="numeric" value={v.account_number} onChange={f('account_number')} />
      </div>
      <div className="field">
        <label htmlFor="sAcct">Account name</label>
        <input id="sAcct" value={v.account_name} onChange={f('account_name')} />
      </div>
      <div className="field">
        <label htmlFor="sWa">Your WhatsApp (for ShopDesk)</label>
        <input id="sWa" inputMode="tel" value={v.whatsapp} onChange={f('whatsapp')} placeholder="e.g. 0803 000 0000" />
      </div>
      <div className="field">
        <label htmlFor="sSells">What do you sell?</label>
        <input
          id="sSells"
          value={v.sells || ''}
          onChange={f('sells')}
          placeholder="e.g. Perfumes and body mists"
          maxLength={120}
        />
      </div>
      <div className="field">
        <label htmlFor="sLoc">Where are you based?</label>
        <input
          id="sLoc"
          value={v.location || ''}
          onChange={f('location')}
          placeholder="e.g. Yaba, Lagos"
          maxLength={80}
        />
      </div>
      <div className="field">
        <label htmlFor="sSoc">Instagram or TikTok (optional)</label>
        <input
          id="sSoc"
          value={v.social || ''}
          onChange={f('social')}
          placeholder="e.g. @roseperfumes"
          maxLength={80}
        />
      </div>
    </>
  );
}

export const checkShop = (v) =>
  v.name.trim().length < 2
    ? 'Enter your business name.'
    : !/^[a-z0-9-]{3,30}$/.test(cleanSlug(v.slug))
      ? 'Your link name needs 3 to 30 letters, numbers or dashes.'
      : !/^\d{10}$/.test(v.account_number.replace(/\s/g, ''))
        ? 'Enter your 10-digit account number.'
        : v.account_name.trim().length < 2
          ? 'Enter the account name.'
          : String(v.whatsapp || '').replace(/\D/g, '').length < 10
            ? 'Enter your WhatsApp number.'
            : String(v.sells || '').trim().length < 3
              ? 'Tell us what you sell.'
              : String(v.location || '').trim().length < 2
                ? 'Tell us where you are based.'
                : '';

export const shopRow = (v) => ({
  name: v.name.trim(),
  slug: cleanSlug(v.slug),
  bank: v.bank,
  account_number: v.account_number.replace(/\s/g, ''),
  account_name: v.account_name.trim(),
  whatsapp: String(v.whatsapp || '').trim(),
  sells: String(v.sells || '').trim(),
  location: String(v.location || '').trim(),
  social: String(v.social || '').trim(),
});
