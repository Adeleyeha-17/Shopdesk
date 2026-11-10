// What went wrong, in words people understand. Every error the app can meet comes through here:
// the database (our own rule messages, and Postgres or PostgREST codes), sign-in, photo uploads, phone alerts,
// and the connection itself (offline, slow, dropped). Nobody should ever see "Failed to fetch" or a code.
//
//   errInfo(e)  -> { kind, text, retry }   kind is one of the KINDS below; retry says a "Try again" makes sense
//   errText(e)  -> just the sentence
//   isNetwork(e) -> true when it's the connection, not the request

export const KINDS = [
  'offline',
  'network',
  'timeout',
  'session',
  'rate',
  'code',
  'permission',
  'outdated',
  'busy',
  'server',
  'input',
  'photo',
  'alerts',
  'rule',
  'unknown',
];

const say = {
  offline: "You're offline. Check your data or Wi-Fi, then try again.",
  network: "Couldn't reach ShopDesk. Check your connection and try again.",
  timeout: 'That took too long. Check your connection and try again.',
  session: 'Your sign-in has expired. Sign in again to carry on.',
  rate: 'Too many tries just now. Wait a minute, then try again.',
  permission: "You don't have permission to do that.",
  outdated: 'ShopDesk was just updated. Refresh the page and try again.',
  busy: 'ShopDesk is busy right now. Try again in a moment.',
  server: 'Something went wrong on our side. Try again in a moment.',
  unknown: 'Something went wrong. Try again.',
};

const NETWORK =
  /failed to fetch|fetch failed|networkerror|network ?error|network request failed|load failed|err_internet|err_network|err_connection|internet connection appears to be offline|the network connection was lost|connection (was )?(reset|refused|closed)|socket hang up|econn/i;
const TIMEOUT = /timeout|timed out|took too long/i;
// messages that are for developers, not people: never shown as they are
const TECHNICAL =
  /\b(fetch|json|jwt|token|undefined|null|nan|typeerror|referenceerror|syntaxerror|unexpected|stack|exception|constraint|relation|column|schema|postgres|postgrest|pgrst|supabase|uuid|sql|cannot read|is not a function|status code|internal server)\b|[{}<>]|::|\bat .+:\d+/i;

function parts(e) {
  if (e == null) return { message: '' };
  if (typeof e === 'string') return { message: e };
  return {
    message: String(e.message || e.error_description || e.msg || e.error || ''),
    code: String(e.code || e.error_code || ''),
    status: Number(e.status || e.statusCode || (e.context && e.context.status) || 0),
    name: String(e.name || ''),
    details: String(e.details || ''),
  };
}

function info(kind, text, retry = false) {
  return { kind, text: text || say[kind] || say.unknown, retry };
}

export function errInfo(e) {
  const { message: raw, code, status, name, details } = parts(e);
  const m = raw.replace(/^.*?ERROR:\s*/, '').trim();
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;

  // 1. the connection
  if (TIMEOUT.test(name) || (name === 'AbortError' && !offline) || /TimeoutError/.test(m))
    return info('timeout', null, true);
  if (offline && (NETWORK.test(m) || NETWORK.test(name) || /Fetch|Retryable/.test(name) || !m))
    return info('offline', null, true);
  if (NETWORK.test(m) || /FunctionsFetchError|AuthRetryableFetchError|StorageUnknownError/.test(name)) {
    return info(offline ? 'offline' : 'network', null, true);
  }

  // 2. our own rules: the database explains them in plain words (raise exception in schema.sql)
  if (code === 'P0001' && m) return info('rule', m);

  // 3. signing in
  if (code === 'otp_expired' || /token has expired or is invalid|otp.*(expired|invalid)/i.test(m))
    return info('code', 'That code is wrong or has expired. Use the newest email, or ask for a new code.');
  if (/only request this after (\d+) seconds?/i.test(m)) {
    const s = m.match(/after (\d+) seconds?/i)[1];
    return info('rate', `For your safety, wait ${s} seconds before asking for another code.`);
  }
  if (status === 429 || /rate.?limit|too many requests|over_.*_limit/i.test(m + ' ' + code))
    return info(
      'rate',
      /email/i.test(m + code) ? 'Too many codes sent just now. Wait a few minutes, then try again.' : null,
    );
  if (code === 'email_address_invalid' || /invalid.*email|email.*invalid/i.test(m))
    return info('input', 'Check the email address and try again.');
  if (
    code === 'PGRST301' ||
    code === 'PGRST303' ||
    code === 'session_not_found' ||
    code === 'refresh_token_not_found' ||
    /jwt expired|invalid jwt|refresh token|auth session missing|session.*(expired|not found)/i.test(m) ||
    (status === 401 && !code)
  )
    return info('session');

  // 4. photos and files
  if (
    status === 413 ||
    /exceeded the maximum allowed size|payload too large|entity too large|file.*too large/i.test(m)
  )
    return info('photo', 'That photo is too big. Pick a smaller one.');
  if (
    /mime type|not supported|invalid.*(file|image)|content.?type/i.test(m) &&
    /image|photo|file|mime/i.test(m)
  )
    return info('photo', "That file type isn't supported. Use a photo (JPG or PNG).");
  if (/already exists/i.test(m) && /object|resource|file/i.test(m))
    return info('photo', 'That photo is already saved. Try again.');

  // 5. phone alerts (the browser's own errors)
  if (name === 'NotAllowedError' || /notifications? (are |were )?(blocked|denied)/i.test(m))
    return info(
      'alerts',
      'Alerts are blocked for ShopDesk. Allow notifications for this site in your phone or browser settings.',
    );
  if (/push service|registration failed|pushmanager|subscribe/i.test(m))
    return info('alerts', "Your browser couldn't turn on alerts. Try again in a moment.", true);

  // 6. database codes
  if (code === '23505') {
    if (/slug/i.test(m + details)) return info('input', 'That shop link is taken. Try another.');
    return info('input', 'That already exists.');
  }
  if (code === '23514') {
    if (/slug_reserved/i.test(m)) return info('input', 'That link name is reserved. Pick another.');
    return info('input', "Something you entered isn't allowed. Check it and try again.");
  }
  if (code === '23502') return info('input', 'Fill in all the details, then try again.');
  if (code === '22001') return info('input', "That's too long. Shorten it and try again.");
  if (code === '22P02' || code === '22007' || code === '22003')
    return info('input', "Something in the form or link isn't right. Check it and try again.");
  if (code === '23503') return info('input', "That's no longer there. Refresh the page.");
  if (code === '42501' || status === 403 || /row-level security|permission denied/i.test(m))
    return info('permission');
  if (code === 'PGRST116') return info('input', "That couldn't be found. It may have been removed.");
  if (
    code === 'PGRST202' ||
    code === 'PGRST204' ||
    code === '42883' ||
    code === '42703' ||
    code === '42P01' ||
    (status === 404 && /function|column|relation/i.test(m))
  )
    return info('outdated');
  if (code === '57014') return info('timeout', null, true);
  if (code === '40001' || code === '40P01' || code === '55P03' || /^53/.test(code) || /^08/.test(code))
    return info('busy', null, true);
  if (status >= 500 || /^XX/.test(code) || /^P0/.test(code)) return info('server', null, true);

  // 7. anything else: a plain sentence is shown as it is; anything technical gets the general message
  if (m && m.length <= 200 && !TECHNICAL.test(m) && !/^[A-Z_]+$/.test(m)) return info('rule', m);
  if (typeof console !== 'undefined') console.warn('ShopDesk error:', e);
  return info('unknown', null, true);
}

export const errText = (e) => errInfo(e).text;
export const isNetwork = (e) => ['offline', 'network', 'timeout'].includes(errInfo(e).kind);
