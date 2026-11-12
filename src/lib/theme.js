// Light or dark. ShopDesk opens in light; anyone can pick Light, Dark or Same as phone (Account for customers,
// the Shop tab for shop owners, the sun/moon at the top of Admin). The choice is kept on that phone or laptop.
// index.html applies the saved choice before the page draws, so there's no flash of the wrong colours.
import { useEffect, useState } from 'react';

const KEY = 'shopdesk-theme';
export const THEMES = [
  ['light', 'Light'],
  ['dark', 'Dark'],
  ['system', 'Same as phone'],
];
const BAR = { light: '#ffffff', dark: '#0d0e10' }; // the phone's browser bar, matching --bg
const listeners = new Set();
const phoneDark =
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

// the saved choice: 'light' (the start), 'dark' or 'system'
export function getTheme() {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'dark' || t === 'system' ? t : 'light';
  } catch (e) {
    return 'light';
  }
}

// what's on screen: 'light' or 'dark'
export function shownTheme(t = getTheme()) {
  return t === 'system' ? (phoneDark && phoneDark.matches ? 'dark' : 'light') : t;
}

function apply() {
  const shown = shownTheme();
  document.documentElement.setAttribute('data-theme', shown);
  const bar = document.querySelector('meta[name="theme-color"]');
  if (bar) bar.setAttribute('content', BAR[shown]);
  listeners.forEach((fn) => fn());
}

export function setTheme(t) {
  try {
    localStorage.setItem(KEY, t);
  } catch (e) {
    /* private browsing: the choice lasts until the page closes */
  }
  apply();
}

// the saved choice, kept up to date
export function useTheme() {
  const [t, setT] = useState(getTheme);
  useEffect(() => {
    const fn = () => setT(getTheme());
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
  return t;
}

if (typeof document !== 'undefined') {
  apply();
  // "Same as phone" follows the phone when it switches; another tab's choice shows here too
  if (phoneDark && phoneDark.addEventListener)
    phoneDark.addEventListener('change', () => getTheme() === 'system' && apply());
  window.addEventListener('storage', (e) => e.key === KEY && apply());
}
