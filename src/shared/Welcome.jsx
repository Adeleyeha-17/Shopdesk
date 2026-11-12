// The first screen for someone new on shopdesk.com.ng (no shop link): Open my shop, or I'm a customer.
// The choice is kept on the phone while they sign in, so the right set-up comes next (VendorApp reads it).
// People who are signed in never see it, and a shop's link goes straight to that shop.
import React, { useState } from 'react';
import { SignIn } from './SignIn.jsx';
import { VendorFrame } from '../vendor/VendorFrame.jsx';

const KEY = 'shopdesk-start';
export function getStart() {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'shop' || v === 'customer' ? v : '';
  } catch (e) {
    return '';
  }
}
export function setStart(v) {
  try {
    if (v) localStorage.setItem(KEY, v);
    else localStorage.removeItem(KEY);
  } catch (e) {
    /* private browsing: the choice lasts until the page closes */
  }
}

const Icon = ({ d }) => (
  <svg className="w-icon" viewBox="0 0 24 24" aria-hidden="true">
    {d}
  </svg>
);
const SHOP = <path d="M4 9l1-5h14l1 5M4 9h16v11H4zM9 20v-6h6v6" />;
const BAG = <path d="M5.5 8h13l-1 12.5h-11zM9 8V6.5a3 3 0 0 1 6 0V8" />;
const CHEV = <path d="M9 6l6 6-6 6" />;
const ORDER = <path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6" />;
const PIN = (
  <>
    <path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z" />
    <circle cx="12" cy="9.5" r="2.5" />
  </>
);
const STAR = <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.6l1-5.8-4.3-4.1 5.9-.9z" />;
export const S_PATH =
  'M42.5 21.5C40.3 18 36.6 16.5 32.2 16.5C25.8 16.5 21.5 19.6 21.5 24.6C21.5 30 26.6 31.4 32 32.3C37.9 33.3 42.8 34.7 42.8 40.2C42.8 45.3 38.4 47.5 32.2 47.5C27.4 47.5 23.6 45.8 21.2 42.3';

// The two choices.
export function Choices({ onPick }) {
  return (
    <div className="w-choices">
      <button type="button" className="w-choice main" onClick={() => onPick('shop')}>
        <span className="w-ic">
          <Icon d={SHOP} />
        </span>
        <span className="w-t">
          <b>Open my shop</b>
          <small>Take orders, check payments and keep track of stock.</small>
        </span>
        <Icon d={CHEV} />
      </button>
      <button type="button" className="w-choice" onClick={() => onPick('customer')}>
        <span className="w-ic">
          <Icon d={BAG} />
        </span>
        <span className="w-t">
          <b>I'm a customer</b>
          <small>Find shops near you and order in a few taps.</small>
        </span>
        <Icon d={CHEV} />
      </button>
    </div>
  );
}

// signedIn: they signed in with "Sign in" and are new, so they only need to say which they are (onPick).
export function Welcome({ signedIn = false, email = '', onPick }) {
  const [step, setStep] = useState('choose'); // choose, shop, customer, signin
  const pick = (k) => {
    setStart(k);
    if (onPick) onPick(k);
    else setStep(k);
  };
  if (step !== 'choose') {
    const words = {
      shop: ['Open your shop', 'Enter your email. We’ll send you a code to start.'],
      customer: ['Join as a customer', 'Enter your email. We’ll send you a code to start.'],
      signin: ['Sign in', 'Use the email you joined with.'],
    }[step];
    return (
      <VendorFrame
        right={
          <button
            className="linkbtn"
            onClick={() => {
              setStart('');
              setStep('choose');
            }}
          >
            Back
          </button>
        }
      >
        <SignIn
          title={words[0]}
          note={words[1]}
          path="/"
          footer={
            <div className="signin-foot">
              <p className="fine">
                By continuing you agree to the{' '}
                <a href={step === 'customer' ? '/privacy' : '/privacy#rules'}>
                  {step === 'customer' ? 'privacy notice' : 'shop rules'}
                </a>
                .
              </p>
            </div>
          }
        />
      </VendorFrame>
    );
  }
  return (
    <div className="app welcome">
      <main className="w">
        <div className="w-hero" aria-hidden="true">
          <div className="w-glow" />
          <div className="w-ring" />
          <div className="w-logo">
            <svg viewBox="0 0 64 64">
              <path d={S_PATH} />
            </svg>
          </div>
          <div className="w-chip c1">
            <span className="w-chip-ic">
              <Icon d={ORDER} />
            </span>
            <span>
              New order<small>2 items · ₦15,000</small>
            </span>
          </div>
          <div className="w-chip c2">
            <i className="w-dot" />
            Paid
          </div>
          <div className="w-chip c3">
            <span className="w-stars">
              {[1, 2, 3, 4, 5].map((k) => (
                <svg key={k} viewBox="0 0 24 24">
                  {STAR}
                </svg>
              ))}
            </span>
            Rated by customers
          </div>
          <div className="w-chip c4">
            <Icon d={PIN} />
            Near you
          </div>
        </div>
        <h1>{signedIn ? 'One more thing' : 'Welcome to ShopDesk'}</h1>
        <p className="w-sub">
          {signedIn ? `How do you want to use ShopDesk${email ? ' with ' + email : ''}?` : 'How do you want to use it?'}
        </p>
        <Choices onPick={pick} />
        {!signedIn && (
          <p className="w-in">
            Already on ShopDesk?{' '}
            <button type="button" className="linkbtn" onClick={() => setStep('signin')}>
              Sign in
            </button>
          </p>
        )}
      </main>
    </div>
  );
}
