// Order links saved on this phone or computer, so a customer's orders can be added to their account when they sign in.

const MINE = 'shopdesk-my-orders';

export function rememberOrder(token) {
  try {
    const l = JSON.parse(localStorage.getItem(MINE) || '[]');
    localStorage.setItem(MINE, JSON.stringify([token, ...l.filter((t) => t !== token)].slice(0, 20)));
  } catch (e) {
    /* private browsing */
  }
}

export function myTokens() {
  try {
    return JSON.parse(localStorage.getItem(MINE) || '[]').filter((t) => /^[0-9a-f-]{36}$/i.test(t));
  } catch (e) {
    return [];
  }
}
