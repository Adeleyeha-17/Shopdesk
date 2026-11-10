// Dates and times, written the way people say them: "today by 4pm", "tomorrow, 12pm", "Thu 6 Nov".

export const DAY = 864e5; // one day in milliseconds

export const timeOf = (t) => new Date(t).toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' });

export const dayOf = (t) =>
  new Date(t).toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short' });

export const startOfDay = (t) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

// Delivery times: "today by 4pm", "tomorrow by 12pm", "Thu 6 Nov by 2pm".
const clock = (d) => {
  const h = d.getHours(),
    m = d.getMinutes();
  return ((h + 11) % 12) + 1 + (m ? ':' + String(m).padStart(2, '0') : '') + (h < 12 ? 'am' : 'pm');
};

export function dayWord(t) {
  const d = new Date(t),
    a = new Date();
  a.setHours(0, 0, 0, 0);
  const b = new Date(d);
  b.setHours(0, 0, 0, 0);
  const n = Math.round((b - a) / 864e5);
  return n === 0
    ? 'today'
    : n === 1
      ? 'tomorrow'
      : n === -1
        ? 'yesterday'
        : d.toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short' });
}

export const whenText = (t) => `${dayWord(t)} by ${clock(new Date(t))}`;

export const atText = (t) => `${dayWord(t)}, ${clock(new Date(t))}`;

// Time slots a shop can promise, and the first one that's at least two hours away.
export const SLOTS = [9, 10, 12, 14, 16, 18, 20];

export function localDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

export function firstSlot(gapHours = 2) {
  const h = new Date().getHours() + gapHours;
  const s = SLOTS.find((x) => x >= h);
  return s ? { date: localDate(0), hour: s } : { date: localDate(1), hour: 12 };
}

export const slotTime = (date, hour) =>
  new Date(`${date}T${String(hour).padStart(2, '0')}:00:00`).toISOString();

export const slotLabel = (h) => ((h + 11) % 12) + 1 + (h < 12 ? 'am' : 'pm');
