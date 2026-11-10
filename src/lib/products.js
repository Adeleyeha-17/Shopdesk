// Products with choices (sizes, colours, packs...) and sale prices, the same way on every page.
// A product either has one price and stock, or a list of options, each with its own price, sale price and stock.

export const options = (p) => (p && Array.isArray(p.options) ? p.options : []);
export const hasOptions = (p) => options(p).length > 0;

// what the customer pays: the sale price when there is one
export const payPrice = (x) => (x.sale_price != null ? x.sale_price : x.price);
export const onSale = (x) => x.sale_price != null && x.sale_price < x.price;

// "Size", "Colour"... in lower case for sentences ("Choose a size")
export const optionWord = (p) => ((p && p.option_label) || 'Size').toLowerCase();

// The lowest price a customer can pay for this product, and whether the choices cost different amounts ("from ₦X").
export function priceFrom(p) {
  const list = options(p);
  if (!list.length) return { price: payPrice(p), was: onSale(p) ? p.price : null, from: false };
  const prices = list.map(payPrice);
  const low = Math.min(...prices);
  const cheapest = list.find((o) => payPrice(o) === low);
  return {
    price: low,
    was: list.length === 1 && onSale(cheapest) ? cheapest.price : null,
    from: new Set(prices).size > 1,
    sale: list.some(onSale),
  };
}

// The vendor's products come with their choices as product_options; give them the same shape as the order page's.
export function withOptions(rows) {
  return (rows || []).map(({ product_options, ...p }) => ({
    ...p,
    options: (product_options || [])
      .slice()
      .sort(
        (a, b) => a.sort_order - b.sort_order || String(a.created_at).localeCompare(String(b.created_at)),
      ),
  }));
}

// Everything that is running low: a product, or each choice of a product that has them.
export function lowStock(products) {
  const out = [];
  (products || [])
    .filter((p) => p.active)
    .forEach((p) => {
      if (hasOptions(p))
        options(p).forEach((o) => {
          if (o.stock <= p.low_at) out.push({ key: o.id, name: `${p.name} · ${o.name}`, stock: o.stock });
        });
      else if (p.stock <= p.low_at) out.push({ key: p.id, name: p.name, stock: p.stock });
    });
  return out;
}

// A map pin the rider can open (Google Maps on Android and iPhone, in the browser elsewhere).
export const mapLink = (lat, lng) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
export const hasPin = (o) => o && o.delivery_lat != null && o.delivery_lng != null;
