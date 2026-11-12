// Invites: shopdesk.com.ng/?invite=<shop link name>. The link name is kept on the phone until the new shop is set up,
// then the shop records who invited it (claim_invite). The inviting shop's name shows on the first screen and set-up.
import { useEffect, useState } from 'react';
import { supabase } from './database.js';

const KEY = 'shopdesk-invite';
try {
  const v = new URLSearchParams(window.location.search).get('invite');
  if (v && /^[a-z0-9-]{3,30}$/i.test(v)) localStorage.setItem(KEY, v.toLowerCase());
} catch (e) {
  /* private browsing */
}

export function getInvite() {
  try {
    return localStorage.getItem(KEY) || '';
  } catch (e) {
    return '';
  }
}
export function clearInvite() {
  try {
    localStorage.removeItem(KEY);
  } catch (e) {
    /* private browsing */
  }
}

// the inviting shop's name, or '' (no invite, or the shop isn't open)
export function useInviter() {
  const [name, setName] = useState('');
  useEffect(() => {
    const slug = getInvite();
    if (!slug) return;
    supabase.rpc('shop_reviews', { p_slug: slug }).then(({ data }) => setName((data && data.name) || ''));
  }, []);
  return name;
}

// after a new shop is saved: record who invited it, once
export async function claimInvite() {
  const slug = getInvite();
  if (!slug) return;
  await supabase.rpc('claim_invite', { p_slug: slug });
  clearInvite();
}
