// The shop this customer was last in, kept in this browser, so the Shop and Cart tabs know where to go.
const KEY = 'shopdesk-last-shop';

export function rememberShop(slug, name) {
  try {
    if (slug) localStorage.setItem(KEY, JSON.stringify({ slug, name: name || '' }));
  } catch (e) {
    /* storage turned off: the Shop and Cart tabs just don't show */
  }
}

export function lastShop() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    return v && v.slug ? v : null;
  } catch (e) {
    return null;
  }
}
