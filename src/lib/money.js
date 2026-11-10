// Money: showing naira amounts, reading typed numbers, and working out what a customer owes on an order.

export const naira = (n) => '₦' + Math.round(Number(n) || 0).toLocaleString('en-NG');

export const toInt = (v) => {
  const n = parseInt(String(v ?? '').replace(/[^\d]/g, ''), 10);
  return Number.isNaN(n) ? null : n;
};

// What the customer pays on an order. Delivery only counts when the customer pays for it.
export const toPay = (o) => o.items_total + (o.delivery_paid_by === 'customer' ? o.delivery_fee || 0 : 0);

// How much is still owed. Only unpaid or part-paid orders owe anything.
export const owes = (o) =>
  o.status === 'awaiting' || o.status === 'part' ? Math.max(0, toPay(o) - o.amount_paid) : 0;

// True when the shop still has to type in a delivery fee: a delivery order, the customer pays delivery, and no fee yet.
// Shops that give free delivery never see a delivery fee box.
export const needsFee = (o) =>
  o.mode === 'delivery' && o.delivery_paid_by === 'customer' && o.delivery_fee == null;
