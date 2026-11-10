// The Stock tab: add products (one price, or sizes with their own prices), change anything about them any time,
// add stock when it comes in, hide or show products, and delete the ones the shop no longer sells.
import React, { useState } from 'react';
import { supabase } from '../lib/database.js';
import { naira, toInt } from '../lib/money.js';
import { photoUrl } from '../lib/photos.js';
import { errText } from '../lib/helpers.js';
import { lowStock, onSale, optionWord, options, payPrice, priceFrom } from '../lib/products.js';
import { ProductForm } from './ProductForm.jsx';

// "₦8,000 ₦9,500" with the old price crossed out, or just the price
function Price({ x }) {
  return (
    <>
      {naira(payPrice(x))}
      {onSale(x) && (
        <>
          {' '}
          <s className="was">{naira(x.price)}</s>
        </>
      )}
    </>
  );
}

// "How many came in?" for a product, or for one of its sizes (picked first)
function AddStock({ p, run, say }) {
  const list = options(p);
  const [qty, setQty] = useState('');
  const [opt, setOpt] = useState(list.length ? list[0].id : '');
  async function add() {
    const n = toInt(qty);
    if (!n) {
      say('Enter how many came in.');
      return;
    }
    const o = list.find((x) => x.id === opt);
    const ok = o
      ? await run(
          'add_option_stock',
          { p_option: o.id, p_qty: n },
          (s) => `${n} × ${p.name} · ${o.name} added. ${s} in stock.`,
        )
      : await run(
          'add_stock',
          { p_product: p.id, p_qty: n },
          (s) => `${n} × ${p.name} added. ${s} in stock.`,
        );
    if (ok) setQty('');
  }
  return (
    <div className="inline">
      {list.length > 0 && (
        <select value={opt} onChange={(e) => setOpt(e.target.value)} aria-label={'Which ' + optionWord(p)}>
          {list.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      )}
      <input
        inputMode="numeric"
        placeholder="How many came in?"
        value={qty}
        onChange={(e) => setQty(e.target.value)}
        aria-label={'How many ' + p.name + ' came in'}
      />
      <button className="btn small" onClick={add}>
        Add stock
      </button>
    </div>
  );
}

export function StockTab({ shop, data, load, run, say }) {
  const [editing, setEditing] = useState(null); // 'new', or the id of the product being changed
  const [deleting, setDeleting] = useState(null); // the product whose "Delete for good?" is showing
  const [busy, setBusy] = useState(false);
  const [find, setFind] = useState(''); // the search box above the products
  function saved(name, isNew) {
    setEditing(null);
    say(
      isNew
        ? `${name} added.${shop.status === 'active' ? '' : ' Customers see it once you’re approved.'}`
        : `${name} saved.`,
    );
    load();
  }
  // Deleting for good. Past orders keep the product's name, price, size and photo; the photo file goes once nothing uses it.
  async function remove(p) {
    setBusy(true);
    const { error } = await supabase.rpc('delete_product', { p_product: p.id });
    setBusy(false);
    setDeleting(null);
    if (error) {
      say(errText(error));
      return;
    }
    supabase.storage.from('product-photos').remove([p.photo_path]);
    say(`${p.name} deleted.`);
    load();
  }
  async function toggle(p) {
    const { error } = await supabase.from('products').update({ active: !p.active }).eq('id', p.id);
    if (error) say(errText(error));
    else {
      say(p.active ? `${p.name} hidden.` : `${p.name} is back on sale.`);
      load();
    }
  }
  // items in unpaid orders are held: by size when the line has one
  const held = {};
  data.orders
    .filter((o) => o.status === 'awaiting')
    .forEach((o) =>
      (o.order_items || []).forEach((i) => {
        const k = i.option_id || i.product_id;
        held[k] = (held[k] || 0) + i.qty;
      }),
    );
  const low = lowStock(data.products);
  const words = find.trim().toLowerCase();
  const shown = words
    ? data.products.filter(
        (p) =>
          p.name.toLowerCase().includes(words) ||
          options(p).some((o) => o.name.toLowerCase().includes(words)),
      )
    : data.products;
  return (
    <>
      {low.length > 0 && (
        <section className="card">
          <h2>Running low</h2>
          <div className="btns">
            {low.map((x) => (
              <span key={x.key} className="chip warn">
                {x.name} · {x.stock} left
              </span>
            ))}
          </div>
        </section>
      )}
      <p className="note">Ordered items are held. Cancelled orders put them back.</p>
      {editing === 'new' ? (
        <ProductForm shop={shop} onDone={saved} onCancel={() => setEditing(null)} />
      ) : (
        <button className="btn" onClick={() => setEditing('new')}>
          Add a product
        </button>
      )}
      {data.products.length > 5 && (
        <div className="search">
          <label htmlFor="stockSearch" className="visually-hidden">
            Search your products
          </label>
          <input
            id="stockSearch"
            type="search"
            value={find}
            onChange={(e) => setFind(e.target.value)}
            placeholder={`Search your ${data.products.length} products`}
            autoComplete="off"
          />
        </div>
      )}
      {find.trim() && !shown.length && <p className="note">No products match “{find.trim()}”.</p>}
      {shown.map((p) => {
        if (editing === p.id)
          return (
            <ProductForm
              key={p.id}
              shop={shop}
              product={p}
              onDone={saved}
              onCancel={() => setEditing(null)}
            />
          );
        const list = options(p);
        const isLow = list.length ? list.some((o) => o.stock <= p.low_at) : p.stock <= p.low_at;
        const from = priceFrom(p);
        const heldHere = list.length ? list.reduce((a, o) => a + (held[o.id] || 0), 0) : held[p.id] || 0;
        return (
          <section
            key={p.id}
            className="card boxed"
            style={p.active && !p.hidden_by_admin ? null : { opacity: 0.6 }}
          >
            <div className="row">
              <div className="row" style={{ justifyContent: 'flex-start', gap: 12 }}>
                <img className="thumb" src={photoUrl(p.photo_path)} alt="" />
                <div>
                  <strong>{p.name}</strong>
                  <div className="sub">
                    {list.length ? (
                      <>
                        {list.length} {list.length === 1 ? optionWord(p) : optionWord(p) + 's'}
                        {' · '}
                        {from.from ? 'from ' : ''}
                        {naira(from.price)}
                        {from.sale ? ' · on sale' : ''}
                      </>
                    ) : (
                      <Price x={p} />
                    )}
                    {' · '}warn at {p.low_at}
                    {p.active ? '' : ' · hidden'}
                  </div>
                </div>
              </div>
              <span className={'chip num ' + (isLow ? 'warn' : 'paid')}>{p.stock} left</span>
            </div>
            {list.length > 0 && (
              <ul className="optlist">
                {list.map((o) => (
                  <li key={o.id}>
                    <span className="optname">{o.name}</span>
                    <span className="sub num">
                      <Price x={o} />
                    </span>
                    <span className={'chip num ' + (o.stock <= p.low_at ? 'warn' : 'paid')}>
                      {o.stock} left{held[o.id] ? ` · ${held[o.id]} held` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {!list.length && heldHere ? <div className="sub">{heldHere} held for unpaid orders</div> : null}
            {!list.length && (
              <div className="stockbar">
                <b
                  style={{
                    width: Math.min(100, Math.round((100 * p.stock) / Math.max(p.low_at * 3, 1))) + '%',
                  }}
                  className={isLow ? 'low' : ''}
                />
              </div>
            )}
            <AddStock key={list.map((o) => o.id).join()} p={p} run={run} say={say} />
            {p.hidden_by_admin ? (
              <>
                <p className="err" style={{ fontSize: 13 }}>
                  Hidden by ShopDesk: {p.hidden_reason} Message ShopDesk if you think this is a mistake.
                </p>
                <div className="btns">
                  <button className="linkbtn" onClick={() => setEditing(p.id)}>
                    Edit
                  </button>
                </div>
              </>
            ) : (
              <div className="btns">
                <button className="btn small ghost" onClick={() => setEditing(p.id)}>
                  Edit
                </button>
                <button className="linkbtn" onClick={() => toggle(p)}>
                  {p.active ? 'Hide from order page' : 'Show on order page'}
                </button>
                <button className="linkbtn" onClick={() => setDeleting(p.id)}>
                  Delete
                </button>
              </div>
            )}
            {deleting === p.id && (
              <div className="confirm-del" role="alert">
                <span>
                  Delete <strong>{p.name}</strong> for good? Orders already placed keep its details.
                </span>
                <div className="btns">
                  <button className="btn small bad" onClick={() => remove(p)} disabled={busy}>
                    {busy ? 'Deleting…' : 'Delete for good'}
                  </button>
                  <button className="linkbtn" onClick={() => setDeleting(null)} disabled={busy}>
                    Keep it
                  </button>
                </div>
              </div>
            )}
          </section>
        );
      })}
      {!data.products.length && editing !== 'new' && <p className="note">No products yet.</p>}
    </>
  );
}
