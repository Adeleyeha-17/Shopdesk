// The one connection to the database (Supabase).
// The address and the public key come from the .env file. If they're missing, the app shows "Almost there".
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;

const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const configured = Boolean(url && key && !/your-project-id/.test(url));

// Every request has a time limit, so a weak connection ends in a clear message instead of a spinner forever.
// Reading (GET) is tried up to 3 times on a dropped connection; saving is never repeated by itself, so nothing
// (an order, a payment) can happen twice.
const LIMIT = { read: 20000, write: 45000, upload: 90000 };
export async function sdFetch(input, init = {}) {
  const href = typeof input === 'string' ? input : (input && input.url) || '';
  const method = String(init.method || (input && input.method) || 'GET').toUpperCase();
  const read = method === 'GET' || method === 'HEAD';
  const limit =
    /\/storage\/v1\/object\//.test(href) && !read ? LIMIT.upload : read ? LIMIT.read : LIMIT.write;
  for (let attempt = 1; ; attempt++) {
    const ctl = new AbortController();
    const outer = init.signal;
    if (outer) {
      if (outer.aborted) ctl.abort(outer.reason);
      else outer.addEventListener('abort', () => ctl.abort(outer.reason), { once: true });
    }
    const timer = setTimeout(
      () => ctl.abort(new DOMException('The request timed out.', 'TimeoutError')),
      limit,
    );
    try {
      return await fetch(input, { ...init, signal: ctl.signal });
    } catch (e) {
      // a dropped connection is tried again; a request that ran out of time is not (that would only double the wait)
      const timedOut = ctl.signal.aborted && !(outer && outer.aborted);
      const again =
        read && !timedOut && attempt < 3 && !(outer && outer.aborted) && navigator.onLine !== false;
      if (!again) throw e;
      await new Promise((r) => setTimeout(r, 600 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }
}

export const supabase = configured ? createClient(url, key, { global: { fetch: sdFetch } }) : null;

export const privacyEmail = import.meta.env.VITE_PRIVACY_EMAIL || '';
