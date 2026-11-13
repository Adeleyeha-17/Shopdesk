// The Orders tab: orders grouped into Not paid, To send, Done, Messages and Problems. Each order is an OrderCard.
// The search box finds an order by its code (BB-1043, or just 1043), the customer's name or phone, or an item.
// Opened from a phone alert, it shows just that order (and opens its chat for a message).
import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/database.js';
import { naira, owes, needsFee } from '../lib/money.js';
import { isActive, problemState } from '../lib/problems.js';
import { OrderCard } from './OrderCard.jsx';

// Does an order match what was typed in the search box?
function matches(o, q) {
  const text = q.trim().toLowerCase();
  if (!text) return true;
  const code = text.match(/^(?:[a-z]{1,3}\s*-?\s*)?#?(\d+)$/);
  if (code) {
    if (String(o.id) === code[1]) return true;
    const digits = code[1];
    if (
      digits.length >= 4 &&
      String(o.customer_phone || '')
        .replace(/\D/g, '')
        .includes(digits)
    )
      return true;
    return false;
  }
  return (
    String(o.customer_name || '')
      .toLowerCase()
      .includes(text) || (o.order_items || []).some((i) => String(i.name).toLowerCase().includes(text))
  );
}

export function OrdersTab({ shop, data, run, say, unread, focus, setFocus, setTab }) {
  const chats = (unread && unread.chats) || {};
  const [filter, setFilter] = useState(() => (Object.keys(chats).length ? 'messages' : 'owing'));
  // Orders with new messages stay in the Messages list after you read them (until you leave the tab).
  const [msgIds, setMsgIds] = useState(() => Object.keys(chats).map(Number));
  const chatKey = Object.keys(chats).join(',');
  useEffect(() => {
    const ids = chatKey ? chatKey.split(',').map(Number) : [];
    setMsgIds((m) => (ids.some((id) => !m.includes(id)) ? [...new Set([...m, ...ids])] : m));
  }, [chatKey]);
  const [query, setQuery] = useState(focus ? String(focus.id) : '');
  useEffect(() => {
    if (focus) setQuery(String(focus.id));
  }, [focus]);
  const [older, setOlder] = useState(null); // an order older than 60 days, found by its number
  const problems = data.problems || [];
  const problemOf = {};
  problems.forEach((p) => (problemOf[p.order_id] = p));
  const groups = {
    owing: (o) => o.status === 'awaiting' || o.status === 'part',
    send: (o) => o.status === 'paid' || o.status === 'out',
    done: (o) => o.status === 'delivered' || o.status === 'cancelled',
    problems: (o) => problemOf[o.id] && isActive(problemOf[o.id]),
    messages: (o) => msgIds.includes(o.id),
  };
  const searching = query.trim() !== '';
  const list = searching ? data.orders.filter((o) => matches(o, query)) : data.orders.filter(groups[filter]);
  const owing = data.orders.filter((o) => owes(o) > 0);
  const feeless = data.orders.filter((o) => o.status === 'awaiting' && needsFee(o)).length;
  const toAnswer = problems.filter((p) => !p.reply && ['open', 'with_shopdesk'].includes(problemState(p)));
  const activeProblems = data.orders.filter(groups.problems).length;

  // Not in the last 60 days? Look the order up by its number.
  const wanted = (query
    .trim()
    .toLowerCase()
    .match(/^(?:[a-z]{1,3}\s*-?\s*)?#?(\d{1,12})$/) || [])[1];
  useEffect(() => {
    setOlder(null);
    if (!wanted || data.orders.some((o) => String(o.id) === wanted)) return undefined;
    let on = true;
    const t = setTimeout(async () => {
      const { data: row } = await supabase
        .from('orders')
        .select('*, order_items(*)')
        .eq('id', wanted)
        .maybeSingle();
      if (on && row) setOlder(row);
    }, 400);
    return () => {
      on = false;
      clearTimeout(t);
    };
  }, [wanted, data.orders]);
  const shown = older && searching ? [...list, older] : list;

  return (
    <>
      {toAnswer.length > 0 && (
        <button
          className="banner bad banner-btn"
          onClick={() => {
            setQuery('');
            setFilter('problems');
          }}
        >
          <strong>
            {toAnswer.length} problem{toAnswer.length === 1 ? '' : 's'} to answer
          </strong>
          <span>Answer within 48 hours or ShopDesk decides.</span>
        </button>
      )}
      {owing.length > 0 && (
        <section className="card owed-line">
          <div className="row">
            <span className="label">
              {owing.length} order{owing.length === 1 ? '' : 's'} waiting for payment
            </span>
            <strong className="num">{naira(owing.reduce((a, o) => a + owes(o), 0))}</strong>
          </div>
          <div className="sub">
            Unpaid orders cancel after 48 hours.
            {feeless > 0 && ` ${feeless} need${feeless === 1 ? 's' : ''} a delivery fee first.`}
          </div>
        </section>
      )}
      <div className="search">
        <label htmlFor="orderSearch" className="visually-hidden">
          Search orders
        </label>
        <input
          id="orderSearch"
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (focus) setFocus(null);
          }}
          placeholder={`Search: ${(shop.order_prefix || 'SD') + '-1043'}, name, phone or item`}
          autoComplete="off"
        />
      </div>
      {!searching && (
        <div className="filters" role="group" aria-label="Show">
          {[
            ['owing', 'Not paid'],
            ['send', 'To send'],
            ['done', 'Done'],
            ...(msgIds.length ? [['messages', 'Messages']] : []),
            ...(activeProblems ? [['problems', 'Problems']] : []),
          ].map(([k, l]) => (
            <button key={k} className="filter" aria-pressed={filter === k} onClick={() => setFilter(k)}>
              {l} ({data.orders.filter(groups[k]).length})
            </button>
          ))}
        </div>
      )}
      {searching && (
        <p className="note">
          {shown.length
            ? `${shown.length} order${shown.length === 1 ? '' : 's'} found`
            : 'No orders match. Try the code from the bank alert.'}
        </p>
      )}
      {shown.length
        ? shown.map((o) => (
            <OrderCard
              key={o.id}
              o={o}
              shop={shop}
              run={run}
              say={say}
              goShop={setTab ? () => setTab('shop') : undefined}
              products={data.products}
              problem={problemOf[o.id]}
              unreadChat={chats[o.id] || 0}
              openChat={!!focus && focus.chat && focus.id === o.id}
              focused={!!focus && focus.id === o.id}
              markRead={unread && unread.markRead}
            />
          ))
        : !searching && <p className="note">No orders here.</p>}
      <p className="note">Older than 60 days? Search the code.</p>
    </>
  );
}
