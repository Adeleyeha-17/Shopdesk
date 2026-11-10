// Problems ("confirm or complain"): the words and rules shared by the shop, the customer and you.
// The database keeps the same rules (supabase/schema.sql: report_problem, answer_problem, problem_customer, admin_decide_problem).
import { naira } from './money.js';

export const KINDS = [
  ['not_arrived', "Didn't arrive"],
  ['wrong_item', 'Wrong item'],
  ['damaged', 'Damaged'],
  ['missing_item', 'Something missing'],
  ['other', 'Something else'],
];
export const kindText = (k) => (KINDS.find((x) => x[0] === k) || [k, 'Problem'])[1];

const HOURS_48 = 48 * 3600e3;
// The shop has 48 hours to answer; after that a problem is with ShopDesk even if nobody has opened it.
export const replyBy = (p) => new Date(new Date(p.created_at).getTime() + HOURS_48);
export const problemState = (p) =>
  p.status === 'open' && Date.now() > replyBy(p).getTime() ? 'with_shopdesk' : p.status;
export const isActive = (p) => ['open', 'answered', 'with_shopdesk'].includes(problemState(p));

// What the shop did, in a few words.
export function replyText(p) {
  if (p.reply === 'refund') return `Refund of ${naira(p.refund_amount)}`;
  if (p.reply === 'resend') return 'Sending it again';
  if (p.reply === 'explain') return 'Explained what happened';
  return '';
}
