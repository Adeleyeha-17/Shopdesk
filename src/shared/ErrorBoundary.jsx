// If something on a page breaks, people get a calm message and a way back instead of a blank screen.
// After an update the phone may still have the old page; that fixes itself with one reload.
import React from 'react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { broken: false };
  }
  static getDerivedStateFromError() {
    return { broken: true };
  }
  componentDidCatch(error, info) {
    console.error('ShopDesk page error:', error, info && info.componentStack);
    const stale = /dynamically imported module|loading chunk|importing a module script failed/i.test(
      String(error && error.message),
    );
    try {
      if (stale && !sessionStorage.getItem('sd-reloaded')) {
        sessionStorage.setItem('sd-reloaded', '1');
        window.location.reload();
      }
    } catch (e) {
      /* private browsing: show the message instead */
    }
  }
  render() {
    if (!this.state.broken) return this.props.children;
    return (
      <div className="app">
        <main>
          <div className="center" role="alert">
            <h2>Something went wrong</h2>
            <p className="note">This page hit a problem. Reloading usually fixes it.</p>
            <div className="btns" style={{ justifyContent: 'center' }}>
              <button className="btn small" onClick={() => window.location.reload()}>
                Reload
              </button>
              <a className="btn small ghost" href="/" style={{ textDecoration: 'none' }}>
                Go to the start
              </a>
            </div>
          </div>
        </main>
      </div>
    );
  }
}
