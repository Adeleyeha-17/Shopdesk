// A thin bar while the phone has no connection, so people know why nothing is updating.
// When the connection comes back, the open page refreshes itself (see useLive in lib/alerts.js).
import React, { useEffect, useState } from 'react';

export function useOnline() {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

export function OfflineBar() {
  const online = useOnline();
  if (online) return null;
  return (
    <div className="offline-bar" role="status">
      You're offline. ShopDesk will update when you're back.
    </div>
  );
}
