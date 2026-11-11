// The demo's alerts. Live updates and unread dots work as in the real app (src/lib/alerts.js); phone alerts can't be
// turned on inside a demo, so "Turn on alerts" says what happens on a real phone instead.
import { demo } from './runtime.js';
import { supabase } from './database.js';

export { useLive, useUnread, channelName } from '../src/lib/alerts.js';
// the demo page keeps its own title and has no app icon
export const useCount = () => {};

let state = 'off';
export const kick = () => {};
export const isInstalled = () => false;
export const alertsState = () => state;
export async function turnOnAlerts(ask = true) {
  if (!ask) return state === 'on';
  await new Promise((r) => setTimeout(r, 300));
  state = 'on';
  demo.setHint(
    'On a real phone, ShopDesk asks to allow alerts. New orders and messages then show on the lock screen.',
  );
  return true;
}
export const useInstall = () => [false, async () => false];
export async function signOut() {
  await supabase.auth.signOut();
}
