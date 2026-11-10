// Adding or changing a product: photo, name, price and sale price, or a list of choices (sizes, colours...)
// each with its own price, sale price and stock. Prices can change any time; orders already placed keep theirs.
import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/database.js';
import { naira, toInt } from '../lib/money.js';
import { photoUrl, shrinkPhoto, newId } from '../lib/photos.js';
import { errText } from '../lib/helpers.js';
import { options } from '../lib/products.js';

const LABELS = ['Size', 'Colour', 'Pack', 'Weight', 'Flavour', 'Length', 'Type'];
let rowKey = 0;
const blankRow = () => ({ key: ++rowKey, id: null, name: '', price: '', sale: '', stock: '', was: null });
const str = (n) => (n == null ? '' : String(n));
const num = (v) => (String(v ?? '').trim() === '' ? null : toInt(v));

// A small number box with its label above it (price, sale price, stock).
function Box({ id, label, value, onChange, placeholder }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

export function ProductForm({ shop, product, onDone, onCancel }) {
  const p = product;
  const [v, setV] = useState(() => ({
    name: p ? p.name : '',
    price: p && !options(p).length ? str(p.price) : '',
    sale: p && !options(p).length ? str(p.sale_price) : '',
    stock: p && !options(p).length ? str(p.stock) : '',
    low: p ? str(p.low_at) : '',
    label: (p && p.option_label) || 'Size',
  }));
  const [sizes, setSizes] = useState(() => !!p && options(p).length > 0);
  const [rows, setRows] = useState(() =>
    p && options(p).length
      ? options(p).map((o) => ({
          key: ++rowKey,
          id: o.id,
          name: o.name,
          price: str(o.price),
          sale: str(o.sale_price),
          stock: str(o.stock),
          was: o.stock,
        }))
      : [blankRow(), blankRow()],
  );
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  const set = (k) => (val) => setV((x) => ({ ...x, [k]: val }));
  const setRow = (key, k, val) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, [k]: val } : r)));
  const word = (v.label.trim() || 'Size').toLowerCase();
  const fid = p ? p.id.slice(0, 8) : 'new';

  async function pick(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    try {
      const b = await shrinkPhoto(f);
      setPhoto(b);
      setPreview(URL.createObjectURL(b));
      setErr('');
    } catch (x) {
      setErr(errText(x));
    }
  }

  // The same checks the database makes, so most mistakes show before anything is sent.
  function check() {
    if (!photo && !p) return "Add a photo. Customers want to see what they're buying.";
    if (!v.name.trim()) return 'Give the product a name.';
    if (v.name.trim().length > 60) return 'Shorten the name to 60 letters or fewer.';
    if (!sizes) {
      const price = num(v.price),
        sale = num(v.sale);
      if (!price) return 'Enter a price in naira.';
      if (sale != null && (sale < 1 || sale >= price))
        return `The sale price must be less than the price (${naira(price)}).`;
      if (num(v.stock) == null) return 'Enter how many you have (0 is fine).';
      return '';
    }
    const used = rows.filter((r) => r.name.trim() || r.price.trim() || r.stock.trim());
    if (!used.length) return `Add at least one ${word}, or choose One price.`;
    const seen = new Set();
    for (const r of used) {
      const name = r.name.trim();
      if (!name) return `Give each ${word} a name, like Small or 50ml.`;
      if (name.length > 30) return `Shorten "${name.slice(0, 30)}" to 30 letters or fewer.`;
      if (seen.has(name.toLowerCase()))
        return `Two choices are called "${name}". Give each one its own name.`;
      seen.add(name.toLowerCase());
      const price = num(r.price),
        sale = num(r.sale);
      if (!price) return `Enter a price for ${name}.`;
      if (sale != null && (sale < 1 || sale >= price))
        return `The sale price for ${name} must be less than its price (${naira(price)}).`;
      if (num(r.stock) == null) return `Enter how many ${name} you have (0 is fine).`;
    }
    if (used.length > 20) return 'A product can have up to 20 choices.';
    return '';
  }

  async function save() {
    const bad = check();
    if (bad) {
      setErr(bad);
      return;
    }
    setBusy(true);
    setErr('');
    // a new photo goes up first; the product only points at it once it's saved
    let path = null;
    if (photo) {
      path = `${shop.id}/${newId()}.jpg`;
      const up = await supabase.storage
        .from('product-photos')
        .upload(path, photo, { contentType: 'image/jpeg' });
      if (up.error) {
        setBusy(false);
        setErr(errText(up.error));
        return;
      }
    }
    // stock is only sent when it was changed here, so orders placed meanwhile aren't undone
    const body = {
      name: v.name.trim(),
      low_at: num(v.low) == null ? (p ? p.low_at : 2) : num(v.low),
      ...(path ? { photo_path: path } : {}),
    };
    if (sizes) {
      body.option_label = v.label.trim().slice(0, 20) || 'Size';
      body.options = rows
        .filter((r) => r.name.trim() || r.price.trim() || r.stock.trim())
        .map((r) => ({
          ...(r.id ? { id: r.id } : {}),
          name: r.name.trim(),
          price: num(r.price),
          sale_price: num(r.sale),
          stock: r.id && num(r.stock) === r.was ? null : num(r.stock),
        }));
    } else {
      body.options = [];
      body.price = num(v.price);
      body.sale_price = num(v.sale);
      body.stock = p && !options(p).length && num(v.stock) === p.stock ? null : num(v.stock);
    }
    const { error } = await supabase.rpc('save_product', { p_product: p ? p.id : null, p: body });
    setBusy(false);
    if (error) {
      setErr(errText(error));
      if (path) supabase.storage.from('product-photos').remove([path]);
      return;
    }
    // the old photo goes once nothing uses it (past orders keep theirs, so it stays for them)
    if (path && p && p.photo_path) supabase.storage.from('product-photos').remove([p.photo_path]);
    onDone(body.name, !p);
  }

  return (
    <section className="card boxed">
      <h2>{p ? `Edit ${p.name}` : 'New product'}</h2>
      <div className="field">
        <span>Photo</span>
        <div className="photo-pick">
          {preview || p ? (
            <img src={preview || photoUrl(p.photo_path)} alt={v.name || 'Product'} />
          ) : (
            <div className="photo-empty" aria-hidden="true" />
          )}
          <label className="btn small ghost" htmlFor={'pPhoto-' + fid}>
            {preview || p ? 'Change photo' : 'Take or choose a photo'}
          </label>
          <input
            id={'pPhoto-' + fid}
            type="file"
            accept="image/*"
            className="visually-hidden"
            onChange={pick}
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor={'pName-' + fid}>Name</label>
        <input
          id={'pName-' + fid}
          value={v.name}
          maxLength={60}
          onChange={(e) => set('name')(e.target.value)}
          placeholder="e.g. Sweet Obsession perfume"
        />
      </div>
      <div className="choices" role="radiogroup" aria-label="Price">
        <button className="choice" role="radio" aria-checked={!sizes} onClick={() => setSizes(false)}>
          <strong>One price</strong>
          <span>Every piece is the same</span>
          <i aria-hidden="true" />
        </button>
        <button className="choice" role="radio" aria-checked={sizes} onClick={() => setSizes(true)}>
          <strong>Different sizes or colours</strong>
          <span>Each with its own price and stock, like 30ml, 50ml, 100ml</span>
          <i aria-hidden="true" />
        </button>
      </div>
      {!sizes ? (
        <>
          <div className="trio">
            <Box
              id={'pPrice-' + fid}
              label="Price (₦)"
              value={v.price}
              onChange={set('price')}
              placeholder="9500"
            />
            <Box
              id={'pSale-' + fid}
              label="Sale price"
              value={v.sale}
              onChange={set('sale')}
              placeholder="Optional"
            />
            <Box
              id={'pQty-' + fid}
              label="In stock"
              value={v.stock}
              onChange={set('stock')}
              placeholder="12"
            />
          </div>
          <p className="note small">
            A sale price is what customers pay, with the old price crossed out. Clear it to end the sale.
          </p>
        </>
      ) : (
        <>
          <div className="field">
            <label htmlFor={'pLabel-' + fid}>What are the choices called?</label>
            <input
              id={'pLabel-' + fid}
              list="choiceWords"
              value={v.label}
              maxLength={20}
              onChange={(e) => set('label')(e.target.value)}
              placeholder="Size"
            />
            <datalist id="choiceWords">
              {LABELS.map((l) => (
                <option key={l} value={l} />
              ))}
            </datalist>
          </div>
          {rows.map((r, i) => (
            <div key={r.key} className="optrow">
              <div className="row">
                <div className="field grow">
                  <label htmlFor={'oName-' + r.key}>
                    {v.label.trim() || 'Size'} {i + 1}
                  </label>
                  <input
                    id={'oName-' + r.key}
                    value={r.name}
                    maxLength={30}
                    onChange={(e) => setRow(r.key, 'name', e.target.value)}
                    placeholder={i === 0 ? 'e.g. 30ml' : i === 1 ? 'e.g. 50ml' : 'e.g. 100ml'}
                  />
                </div>
                {rows.length > 1 && (
                  <button
                    className="linkbtn"
                    onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                    aria-label={'Remove ' + (r.name || word + ' ' + (i + 1))}
                  >
                    Remove
                  </button>
                )}
              </div>
              <div className="trio">
                <Box
                  id={'oPrice-' + r.key}
                  label="Price (₦)"
                  value={r.price}
                  onChange={(x) => setRow(r.key, 'price', x)}
                  placeholder="15000"
                />
                <Box
                  id={'oSale-' + r.key}
                  label="Sale price"
                  value={r.sale}
                  onChange={(x) => setRow(r.key, 'sale', x)}
                  placeholder="Optional"
                />
                <Box
                  id={'oQty-' + r.key}
                  label="In stock"
                  value={r.stock}
                  onChange={(x) => setRow(r.key, 'stock', x)}
                  placeholder="4"
                />
              </div>
            </div>
          ))}
          {rows.length < 20 && (
            <div className="btns">
              <button className="btn small ghost" onClick={() => setRows((rs) => [...rs, blankRow()])}>
                Add another {word}
              </button>
            </div>
          )}
          {p && options(p).length > 0 && (
            <p className="note small">Removing a {word} doesn't change orders already placed.</p>
          )}
        </>
      )}
      <div className="field">
        <label htmlFor={'pLow-' + fid}>Warn me when {sizes ? `a ${word}` : 'it'} gets down to</label>
        <input
          id={'pLow-' + fid}
          inputMode="numeric"
          value={v.low}
          onChange={(e) => set('low')(e.target.value)}
          placeholder="e.g. 3"
        />
      </div>
      {p && (
        <p className="note small">New prices apply to new orders. Orders already placed keep their prices.</p>
      )}
      {err && <p className="err">{err}</p>}
      <div className="btns">
        <button className="btn" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : p ? 'Save changes' : 'Add product'}
        </button>
        <button className="btn ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </section>
  );
}
