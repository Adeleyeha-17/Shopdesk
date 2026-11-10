// Text about an order that the vendor copies or reads: the items list and the payment message for the customer.
import { naira, toPay, owes } from '../lib/money.js';
import { orderCode } from '../lib/helpers.js';

export function itemsText(o) {
  return (o.order_items || []).map((i) => i.qty + ' × ' + i.name).join(', ');
}

export function payMessage(shop, o) {
  const fee = o.delivery_paid_by === 'customer' && o.delivery_fee ? o.delivery_fee : 0;
  return (
    `Hi ${o.customer_name.split(' ')[0]}, thank you for your order ${orderCode(shop, o)} (${itemsText(o)}).\n` +
    (fee
      ? `Items ${naira(o.items_total)} + delivery ${naira(fee)} = ${naira(toPay(o))}.\n`
      : `Total ${naira(toPay(o))}${o.mode === 'delivery' ? ', with free delivery' : ''}.\n`) +
    `Please send ${naira(owes(o))} in one transfer to ${shop.bank} ${shop.account_number} (${shop.account_name}), and put ${orderCode(shop, o)} in the transfer note. I'll pack it as soon as it lands.\n` +
    `Follow your order here: ${window.location.origin}/o/${o.public_token}`
  );
}
