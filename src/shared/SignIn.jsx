// Sign in with email: we email a 6-digit code, the person types it in. No passwords.
// Used by customers (shop page, My orders), vendors (the main page) and you (/admin).
import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/database.js';
import { errText } from '../lib/helpers.js';

// Email sign-in in two steps. We email a code and a link. Typing the code works wherever the email was opened
// (phone, laptop, Gmail app); the link only signs in the browser it opens in.
// owner: true means no new accounts are made here (the /admin page).
export function SignIn({ title, note, path = '/', owner = false, footer = null, compact = false }) {
  const box = compact ? 'stack-sm' : 'center';
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState('email');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [wait, setWait] = useState(0);
  useEffect(() => {
    if (!wait) return undefined;
    const t = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);
  const em = email.trim().toLowerCase();
  // the browser tab reads "Sign in · ShopDesk" while the full sign-in page is showing
  useEffect(() => {
    if (compact) return undefined;
    const before = document.title;
    document.title = 'Sign in · ShopDesk';
    return () => {
      document.title = before;
    };
  }, [compact]);
  const Title = compact ? 'h2' : 'h1';

  async function send(e) {
    if (e) e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(em)) {
      setErr('Enter a valid email address.');
      return;
    }
    setBusy(true);
    setErr('');
    const { error } = await supabase.auth.signInWithOtp({
      email: em,
      options: { emailRedirectTo: window.location.origin + path, shouldCreateUser: !owner },
    });
    setBusy(false);
    if (error) {
      setErr(
        owner && /signup|not allowed|not found/i.test(error.message || '')
          ? 'There is no owner account with that email.'
          : mailErr(error),
      );
      return;
    }
    setStep('code');
    setCode('');
    setWait(60);
  }

  async function verify(e, typed) {
    if (e) e.preventDefault();
    const c = (typed ?? code).replace(/\D/g, '');
    if (c.length !== 6) {
      setErr('Type the 6-digit code from the email.');
      return;
    }
    if (busy) return;
    setBusy(true);
    setErr('');
    const { error } = await supabase.auth.verifyOtp({ email: em, token: c, type: 'email' });
    setBusy(false);
    if (error)
      setErr(
        /expired|invalid|not found/i.test(error.message || '')
          ? 'Wrong or expired code. Use the newest email.'
          : mailErr(error),
      );
    // When it works, the page that showed this form sees the new session and moves on.
  }

  if (step === 'code') {
    return (
      <div className={box}>
        <Title className={compact ? null : 'signin-title'} style={compact ? { fontSize: 16 } : null}>
          Check your email
        </Title>
        <p className="note">
          Code sent to <strong>{em}</strong>.
        </p>
        <form onSubmit={verify} className={compact ? 'stack-sm' : 'card'}>
          <div className="field">
            <label htmlFor="code">6-digit code</label>
            <input
              id="code"
              className="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, '').slice(0, 6);
                setCode(v);
                setErr('');
                if (v.length === 6) verify(null, v);
              }}
              autoFocus
            />
          </div>
          {err && (
            <p className="err" role="alert">
              {err}
            </p>
          )}
          <button className="btn" disabled={busy}>
            {busy ? 'Checking…' : 'Sign in'}
          </button>
        </form>
        <div className="btns" style={{ justifyContent: 'space-between' }}>
          <button className="linkbtn" onClick={() => send()} disabled={busy || wait > 0}>
            {wait ? `Send a new code in ${wait}s` : 'Send a new code'}
          </button>
          <button
            className="linkbtn"
            onClick={() => {
              setStep('email');
              setErr('');
            }}
          >
            Use a different email
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className={box}>
      <Title className={compact ? null : 'signin-title'} style={compact ? { fontSize: 16 } : null}>
        {title}
      </Title>
      {note && <p className="note">{note}</p>}
      <form onSubmit={send} className={compact ? 'stack-sm' : 'card'}>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="send"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="yourname@gmail.com"
          />
        </div>
        {err && (
          <p className="err" role="alert">
            {err}
          </p>
        )}
        <button className="btn" disabled={busy}>
          {busy ? 'Sending…' : 'Email me a code'}
        </button>
      </form>
      {footer}
    </div>
  );
}

// Sign-in problems (wrong code, too many codes, no connection) all have their own message in errors.js.
const mailErr = (e) => errText(e);
