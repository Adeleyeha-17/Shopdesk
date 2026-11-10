// Starts the app: loads the styles, puts the App on the page, and starts the part that shows phone alerts (public/sw.js).
// A page that breaks shows a calm "Something went wrong" (ErrorBoundary); no connection shows a thin bar (OfflineBar).
import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App.jsx';
import { ErrorBoundary } from './shared/ErrorBoundary.jsx';
import { OfflineBar } from './shared/OfflineBar.jsx';

createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <OfflineBar />
    <App />
  </ErrorBoundary>,
);

// Anything that fails in the background is noted for us in the console, never shown as raw text.
window.addEventListener('unhandledrejection', (e) => console.warn('ShopDesk background error:', e.reason));

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
