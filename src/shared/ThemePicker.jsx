// Light, Dark or Same as phone: on the customer's Account page and the shop owner's Shop tab.
// ThemeButton is the sun/moon at the top of Admin, flipping between light and dark.
import React from 'react';
import { THEMES, setTheme, shownTheme, useTheme } from '../lib/theme.js';

export function ThemePicker() {
  const t = useTheme();
  return (
    <section className="card">
      <h2 id="themeTitle">Appearance</h2>
      <div className="seg wide" role="group" aria-labelledby="themeTitle">
        {THEMES.map(([k, label]) => (
          <button key={k} type="button" aria-pressed={t === k} onClick={() => setTheme(k)}>
            {label}
          </button>
        ))}
      </div>
      {t === 'system' && <p className="note">Switches with your phone's light or dark setting.</p>}
    </section>
  );
}

export function ThemeButton() {
  const t = useTheme();
  const dark = shownTheme(t) === 'dark';
  return (
    <button
      type="button"
      className="theme-btn"
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={dark ? 'Light mode' : 'Dark mode'}
    >
      {dark ? (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
        </svg>
      )}
    </button>
  );
}
