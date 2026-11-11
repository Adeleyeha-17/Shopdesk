// Starts the ShopDesk demo: the real app, a pretend database with a sample shop, and a small bar on top
// to switch between the shop owner's app and what a customer sees.
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/styles.css';
import './demo.css';
import { demo } from './runtime.js';
import { signInAs, whoIsIn, resetDemo, VENDOR, CUSTOMER, monthEndAlert } from './database.js';
import { App } from '../src/App.jsx';
import { navigate } from '../src/lib/helpers.js';

function go(path) {
  demo.go(path);
  window.dispatchEvent(new Event('popstate'));
  window.scrollTo(0, 0);
}

// Links inside the app (/orders, /o/..., /privacy, the shop's own page) open here instead of leaving the demo,
// moving the same way they do on the real site.
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
  const a = e.target.closest ? e.target.closest('a[href]') : null;
  const href = a && a.getAttribute('href');
  // phone numbers in the demo are made up, so a call link says what it does on the real site instead of dialling a stranger
  if (href && href.startsWith('tel:')) {
    e.preventDefault();
    const n = href.slice(4).replace(/^\+234/, '0');
    demo.setHint(
      `On the real site this rings ${n.replace(/^(\d{4})(\d{3})(\d{4})$/, '$1 $2 $3')} straight away. Numbers in the demo are made up.`,
    );
    window.scrollTo(0, 0);
    return;
  }
  if (!href || href[0] !== '/' || href[1] === '/') return;
  e.preventDefault();
  navigate(href, { move: a.dataset.move });
});

// shows the month-end report alert, which the real database sends on the last day of each month
demo.monthEndAlert = monthEndAlert;

function switchTo(kind) {
  demo.setHint('');
  signInAs(kind === 'vendor' ? VENDOR : CUSTOMER);
  if (kind === 'vendor') demo.setHash('sales');
  go(kind === 'vendor' ? '/' : '/bimpes-beauty');
}

function DemoBar({ onReset }) {
  const [, tick] = useState(0);
  useEffect(() => demo.subscribe(() => tick((x) => x + 1)), []);
  const who = whoIsIn();
  return (
    <div className="demo-bar">
      <div className="demo-in">
        <div className="demo-row">
          <span className="demo-tag">Demo</span>
          <div className="demo-seg" role="group" aria-label="See ShopDesk as">
            <button type="button" aria-pressed={who === 'vendor'} onClick={() => switchTo('vendor')}>
              Shop owner
            </button>
            <button type="button" aria-pressed={who === 'customer'} onClick={() => switchTo('customer')}>
              Customer
            </button>
          </div>
          <button type="button" className="demo-reset" onClick={onReset}>
            Reset
          </button>
        </div>
        <p className="demo-note" role="status">
          {demo.hint ||
            (who === 'customer'
              ? "You're Funmi, a customer of Bimpe's Beauty Store. Order something, then switch to Shop owner to see it arrive."
              : 'A sample shop with made-up customers and orders. Tap anything: nothing is real and nothing is sent.')}
        </p>
      </div>
    </div>
  );
}

function Root() {
  const [epoch, setEpoch] = useState(0);
  function reset() {
    resetDemo();
    demo.setHint('');
    demo.setHash('sales');
    demo.go('/');
    setEpoch((e) => e + 1);
    window.scrollTo(0, 0);
  }
  return (
    <>
      <DemoBar onReset={reset} />
      <App key={epoch} />
    </>
  );
}

createRoot(document.getElementById('root')).render(<Root />);
