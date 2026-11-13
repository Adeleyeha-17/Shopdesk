// Pay online and ShopDesk Delivery: whether each is switched on (asked once per page load), and the money server
// function that talks to Paystack and the courier service (supabase/functions/money).
// Both stay hidden until Admin switches them on, and also if the database hasn't been updated yet.
import { useEffect, useState } from 'react';
import { supabase } from './database.js';

const OFF = { online: false, delivery: false };
let switches = null;
export function moneySwitches() {
  if (!switches)
    switches = supabase.rpc('money_switches').then(
      ({ data, error }) => (error || !data ? OFF : data),
      () => OFF,
    );
  return switches;
}
export function useMoneySwitches() {
  const [s, setS] = useState(OFF);
  useEffect(() => {
    let on = true;
    moneySwitches().then((x) => on && setS(x));
    return () => {
      on = false;
    };
  }, []);
  return s;
}

// Calls the money function. Throws with a sentence the person can read.
export async function money(action, body = {}) {
  const { data, error } = await supabase.functions.invoke('money', { body: { action, ...body } });
  if (error || !data) throw new Error("Couldn't reach ShopDesk. Check your connection and try again.");
  if (data.error) throw new Error(data.error);
  return data;
}

// What the courier service says about a delivery, in plain words.
const STATUS = {
  pending: 'Booked · waiting for pickup',
  confirmed: 'Booked · waiting for pickup',
  picked_up: 'Picked up',
  in_transit: 'On the way',
  out_for_delivery: 'Out for delivery',
  completed: 'Delivered',
  delivered: 'Delivered',
  cancelled: 'Cancelled by the courier',
};
export const shipStatus = (s) =>
  STATUS[s] || (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : 'Booked');
