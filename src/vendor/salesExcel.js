// The Excel sales report: the Full report as a workbook that keeps working after it's downloaded.
// The yellow box on Summary picks the period (any month, this year, last year, your own dates...), and Summary plus
// the sheets marked ⟳ work themselves out again with formulas. Orders, Items, Payments and Money out hold every row
// from 1 January last year, so any period can be picked. Each formula is saved with its answer for the period
// that was on screen, so the file shows the same numbers as the app the moment it opens.
import { naira, toPay } from '../lib/money.js';
import { orderCode } from '../lib/helpers.js';
import { downloadXlsx, excelDate, quoteSheet, col } from '../lib/xlsx.js';
import { periodFor } from './salesMath.js';
import { SOURCES, OUT_KINDS, outKind, customerKey } from './report.js';
import { splitPayment, owedIncome } from './salesMath.js';

const DONE = ['paid', 'out', 'delivered'];
const STATUS = {
  awaiting: 'Not paid',
  part: 'Part paid',
  paid: 'Paid',
  out: 'With rider',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};
const FOLLOWS = '⟳ Follows the period picked on Summary.';
const BLUE = '2563EB';
const RED = 'F97316';
const GREEN = '16A34A';
const sum = (list, f) => list.reduce((a, x) => a + (Number(f(x)) || 0), 0);
const label = {
  today: 'Today',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  month: 'This month',
  year: 'This year',
  custom: 'Your own dates',
};

// The choices in the Period box, each with its dates and the dates it's compared with.
function periodChoices(since, now) {
  const out = [];
  for (const k of ['today', '7d', '30d', 'month', 'year']) {
    const p = periodFor(k, now);
    out.push([label[k], p.start, p.end, p.prevStart, p.prevEnd]);
  }
  const n = new Date(now);
  for (let m = n.getMonth() - 1, y = n.getFullYear(); +new Date(y, m, 1) >= since; m--) {
    const a = +new Date(y, m, 1),
      b = +new Date(y, m + 1, 1) - 1;
    out.push([
      new Date(a).toLocaleDateString('en-NG', { month: 'long', year: 'numeric' }),
      a,
      b,
      +new Date(y, m - 1, 1),
      a - 1,
    ]);
  }
  const y = n.getFullYear() - 1;
  out.push([
    'Last year',
    +new Date(y, 0, 1),
    +new Date(y + 1, 0, 1) - 1,
    +new Date(y - 1, 0, 1),
    +new Date(y, 0, 1) - 1,
  ]);
  out.push(['Your own dates', null, null, null, null]);
  return out;
}

// A data sheet: title, a note, a "total of rows showing" line, the column headings, then the rows as a table with
// filter buttons. columns: [{ h, w, s, total: 'sum' | 'count', hide }]
function dataSheet({ name, table, title, note, columns, rows, freezeCols = 1, charts, rules, tab }) {
  const n = Math.max(1, rows.length);
  const last = 4 + n; // last data row, counted from 1
  const total = columns.map((c, i) => {
    if (i === 0) return { v: 'Total', s: 'totalText' };
    if (!c.total) return { v: '', s: 'totalBlank' };
    const L = col(i);
    const values = rows.map((r) => {
      const x = r[i];
      return typeof x === 'object' && x ? x.v : x;
    });
    return c.total === 'count'
      ? {
          f: `SUBTOTAL(103,${L}5:${L}${last})`,
          v: values.filter((v) => v !== '' && v != null).length,
          s: 'totalInt',
        }
      : {
          f: `SUBTOTAL(109,${L}5:${L}${last})`,
          v: sum(values, (v) => (typeof v === 'number' ? v : 0)),
          s: c.s === 'int' ? 'totalInt' : 'totalMoney',
        };
  });
  const styled = rows.map((r) =>
    r.map((x, i) => (x && typeof x === 'object' ? { s: columns[i].s, ...x } : { v: x, s: columns[i].s })),
  );
  return {
    name,
    widths: columns.map((c) => c.w || 14),
    hide: columns.map((c, i) => (c.hide ? i : -1)).filter((i) => i >= 0),
    rows: [
      [{ v: title || name, s: 'title' }],
      [{ v: note || '', s: 'note' }],
      total,
      columns.map((c) => ({ v: c.h, s: 'head' })),
      ...(rows.length ? styled : [columns.map(() => '')]),
    ],
    heights: { 0: 30, 3: 34 },
    freeze: { rows: 4, cols: freezeCols },
    table: { name: table, ref: `A4:${col(columns.length - 1)}${last}`, cols: columns.length },
    charts,
    rules,
    tab,
    last,
  };
}

export function salesWorkbook(r, shop, raw, now = Date.now()) {
  const { period, s, money: m } = r;
  const X = excelDate;
  const orders = raw.orders.slice().sort((a, b) => a.id - b.id);
  const code = (o) => orderCode(shop, o);
  const oN = 4 + Math.max(1, orders.length);
  const O = (L) => `Orders!$${L}$5:$${L}$${oN}`;

  // ---------- Orders: every order from 1 January last year ----------
  const ordersSheet = dataSheet({
    name: 'Orders',
    table: 'OrdersTable',
    title: 'Orders',
    note: 'Every order since 1 January last year. Use the filter buttons on the headings; the total line adds up what is showing. Tap an order code to open it in ShopDesk.',
    columns: [
      { h: 'Order', w: 10 },
      { h: 'Placed', w: 21, s: 'datetime' },
      { h: 'Customer', w: 22 },
      { h: 'Phone', w: 15 },
      { h: 'Area', w: 16 },
      { h: 'Source', w: 15 },
      { h: 'Delivery or pick-up', w: 12 },
      { h: 'Items', w: 40 },
      { h: 'Items total', w: 13, s: 'money', total: 'sum' },
      { h: 'Delivery fee', w: 12, s: 'money', total: 'sum' },
      { h: 'Customer pays', w: 14, s: 'money', total: 'sum' },
      { h: 'Paid so far', w: 13, s: 'money', total: 'sum' },
      { h: 'Still owed (your sales)', w: 14, s: 'money', total: 'sum' },
      { h: 'Status', w: 12 },
      { h: 'Paid on', w: 21, s: 'datetime' },
      { h: 'Paid (1 = yes)', w: 8, s: 'int', total: 'sum' },
      { h: 'With rider on', w: 21, s: 'datetime' },
      { h: 'Rider', w: 14 },
      { h: 'Customer key', w: 10, hide: true },
      { h: 'Days to pay', w: 9, s: 'dec' },
    ],
    rows: orders.map((o) => [
      { f: `HYPERLINK("https://shopdesk.com.ng/?order=${o.id}#orders","${code(o)}")`, v: code(o), s: 'link' },
      X(o.created_at),
      o.customer_name || '',
      o.customer_phone || '',
      o.mode === 'pickup' ? 'Pick-up' : o.area || 'Not given',
      SOURCES[o.source || 'direct'] || SOURCES.direct,
      o.mode === 'pickup' ? 'Pick-up' : 'Delivery',
      (o.order_items || []).map((i) => `${i.qty} × ${i.name}`).join(', '),
      o.items_total,
      o.mode === 'delivery' && o.delivery_paid_by === 'customer' ? (o.delivery_fee ?? '') : '',
      toPay(o),
      o.amount_paid,
      owedIncome(o),
      STATUS[o.status] || o.status,
      o.paid_at ? X(o.paid_at) : '',
      DONE.includes(o.status) ? 1 : 0,
      o.out_at ? X(o.out_at) : '',
      o.rider_name || '',
      'c:' + customerKey(o),
      o.paid_at ? Math.round(((Date.parse(o.paid_at) - Date.parse(o.created_at)) / 864e5) * 10) / 10 : '',
    ]),
  });

  // ---------- Items: every line of every order ----------
  const lines = [];
  orders.forEach((o) =>
    (o.order_items || []).forEach((i) =>
      lines.push([
        X(o.created_at),
        code(o),
        i.name,
        i.qty,
        i.price,
        i.was_price && i.was_price > i.price ? i.was_price : '',
        i.was_price && i.was_price > i.price ? (i.was_price - i.price) * i.qty : 0,
        i.price * i.qty,
        o.paid_at ? X(o.paid_at) : '',
        DONE.includes(o.status) ? 1 : 0,
      ]),
    ),
  );
  const iN = 4 + Math.max(1, lines.length);
  const I = (L) => `Items!$${L}$5:$${L}$${iN}`;
  const itemsSheet = dataSheet({
    name: 'Items',
    table: 'ItemsTable',
    title: 'Items sold',
    note: 'Every item on every order, line by line. "Was" is the price before a sale; the discount is what the sale took off.',
    columns: [
      { h: 'Placed', w: 21, s: 'datetime' },
      { h: 'Order', w: 10 },
      { h: 'Product', w: 32 },
      { h: 'Quantity', w: 9, s: 'int', total: 'sum' },
      { h: 'Price', w: 11, s: 'money' },
      { h: 'Was', w: 11, s: 'money' },
      { h: 'Discount', w: 11, s: 'money', total: 'sum' },
      { h: 'Line total', w: 12, s: 'money', total: 'sum' },
      { h: 'Paid on', w: 21, s: 'datetime' },
      { h: 'Paid (1 = yes)', w: 8, s: 'int' },
    ],
    rows: lines,
    rules: [{ ref: `G5:G${iN}`, when: '$G5>0', style: 'good' }],
  });

  // ---------- Payments ----------
  const pays = raw.payments.slice().sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const pN = 4 + Math.max(1, pays.length);
  const Pm = (L) => `Payments!$${L}$5:$${L}$${pN}`;
  const paymentsSheet = dataSheet({
    name: 'Payments',
    table: 'PaymentsTable',
    title: 'Money in',
    note: 'Every payment. "Your sales" is your part; "For the rider" is delivery money you pass on.',
    columns: [
      { h: 'Received', w: 21, s: 'datetime' },
      { h: 'Order', w: 10 },
      { h: 'Customer', w: 22 },
      { h: 'Money received', w: 15, s: 'money', total: 'sum' },
      { h: 'Your sales', w: 13, s: 'money', total: 'sum' },
      { h: 'For the rider', w: 13, s: 'money', total: 'sum' },
      { h: 'Source', w: 15 },
      { h: 'Confirmed by', w: 13 },
    ],
    rows: pays.map((p) => {
      const sp = splitPayment(p.amount, p.orders);
      return [
        X(p.created_at),
        `${shop.order_prefix || 'SD'}-${p.order_id}`,
        p.orders ? p.orders.customer_name : '',
        p.amount,
        sp.income,
        sp.delivery,
        SOURCES[(p.orders && p.orders.source) || 'direct'],
        p.method === 'tap' ? 'You' : 'Bank alert',
      ];
    }),
  });

  // ---------- Money out ----------
  const outs = raw.moneyOut.slice().sort((a, b) => (a.spent_on < b.spent_on ? -1 : 1));
  const mN = 4 + Math.max(1, outs.length);
  const M = (L) => `${quoteSheet('Money out')}!$${L}$5:$${L}$${mN}`;
  const outSheet = dataSheet({
    name: 'Money out',
    table: 'MoneyOutTable',
    title: 'Money out',
    note: 'What you spent to run the shop. Add more in ShopDesk (Sales → Add money out) so every report has it.',
    columns: [
      { h: 'Date', w: 14, s: 'date' },
      { h: 'What for', w: 18 },
      { h: 'Note', w: 34 },
      { h: 'Amount', w: 13, s: 'money', total: 'sum' },
    ],
    rows: outs.map((x) => [X(x.spent_on + 'T00:00:00'), outKind(x.kind), x.note || '', x.amount]),
  });

  const inP = (range) => `${range},">="&PeriodStart,${range},"<="&PeriodEnd`;
  const inPrev = (range) => `${range},">="&PrevStart,${range},"<="&PrevEnd`;

  // ---------- Products ⟳ ----------
  const prodRows = r.products;
  const prN = 4 + Math.max(1, prodRows.length);
  const productsSheet = dataSheet({
    name: 'Products',
    table: 'ProductsTable',
    title: 'Products',
    note: `${FOLLOWS} Sold and sales count fully paid orders. Stock and "runs out in" are as they were when you downloaded this.`,
    columns: [
      { h: 'Product', w: 32 },
      { h: 'Sold', w: 9, s: 'int', total: 'sum' },
      { h: 'Sales', w: 13, s: 'money', total: 'sum' },
      { h: 'Share of sales', w: 10, s: 'pct' },
      { h: 'Sold before', w: 10, s: 'int', total: 'sum' },
      { h: 'Change', w: 10, s: 'change' },
      { h: 'In stock', w: 9, s: 'int', total: 'sum' },
      { h: 'Stock value', w: 13, s: 'money', total: 'sum' },
      { h: 'Sells a week', w: 10, s: 'dec' },
      { h: 'Runs out in (days)', w: 11, s: 'int' },
      { h: 'Rank', w: 6, hide: true },
    ],
    rows: prodRows.map((p, k) => {
      const row = 5 + k;
      const crit = `${I('C')},"="&$A${row}`;
      return [
        p.name,
        { f: `SUMIFS(${I('D')},${crit},${inP(I('I'))},${I('J')},1)`, v: p.qty },
        { f: `SUMIFS(${I('H')},${crit},${inP(I('I'))},${I('J')},1)`, v: p.sales },
        { f: `IF(SUM($C$5:$C$${prN})=0,0,C${row}/SUM($C$5:$C$${prN}))`, v: p.share },
        { f: `SUMIFS(${I('D')},${crit},${inPrev(I('I'))},${I('J')},1)`, v: p.qtyBefore },
        {
          f: `IF(E${row}=0,IF(B${row}>0,"New",""),B${row}/E${row}-1)`,
          v: p.qtyBefore ? p.qty / p.qtyBefore - 1 : p.qty ? 'New' : '',
        },
        p.stock ?? '',
        p.stockValue ?? '',
        p.perWeek || '',
        p.runsOut ?? '',
        { f: `C${row}+B${row}/1000+ROW()/10000000`, v: p.sales + p.qty / 1000 + row / 1e7 },
      ];
    }),
    rules: [
      { ref: `C5:C${prN}`, bar: '93C5FD' },
      { ref: `F5:F${prN}`, when: `AND(ISNUMBER($F5),$F5>0)`, style: 'good' },
      { ref: `F5:F${prN}`, when: `AND(ISNUMBER($F5),$F5<0)`, style: 'bad' },
      { ref: `J5:J${prN}`, when: `AND(ISNUMBER($J5),$J5<=7)`, style: 'bad' },
    ],
  });

  // ---------- Customers ⟳ ----------
  const custRows = r.customers;
  const cN = 4 + Math.max(1, custRows.length);
  const customersSheet = dataSheet({
    name: 'Customers',
    table: 'CustomersTable',
    title: 'Customers',
    note: `${FOLLOWS} "All" columns count everything in this file. Regular = 3 or more paid orders.`,
    columns: [
      { h: 'Customer', w: 22 },
      { h: 'Phone', w: 15 },
      { h: 'Area', w: 16 },
      { h: 'Orders', w: 9, s: 'int', total: 'sum' },
      { h: 'Spent', w: 13, s: 'money', total: 'sum' },
      { h: 'All orders', w: 10, s: 'int', total: 'sum' },
      { h: 'All spent', w: 13, s: 'money', total: 'sum' },
      { h: 'First order', w: 13, s: 'date' },
      { h: 'Last order', w: 13, s: 'date' },
      { h: 'Regular', w: 9 },
      { h: 'Key', w: 6, hide: true },
      { h: 'Rank', w: 6, hide: true },
    ],
    rows: custRows.map((c, k) => {
      const row = 5 + k;
      const crit = `${O('S')},"="&$K${row}`;
      return [
        c.name,
        c.phone,
        c.area,
        { f: `COUNTIFS(${crit},${inP(O('B'))},${O('N')},"<>Cancelled")`, v: c.periodOrders },
        { f: `SUMIFS(${O('I')},${crit},${inP(O('B'))},${O('P')},1)`, v: c.periodSpent },
        c.orders,
        c.spent,
        X(c.first),
        X(c.last),
        c.regular ? 'Regular' : '',
        'c:' + c.key,
        { f: `E${row}+D${row}/1000+ROW()/10000000`, v: c.periodSpent + c.periodOrders / 1000 + row / 1e7 },
      ];
    }),
    rules: [{ ref: `E5:E${cN}`, bar: '93C5FD' }],
  });

  // ---------- Sources ⟳, Areas ⟳, Riders ⟳ ----------
  const srcNames = Object.values(SOURCES);
  const srcN = 4 + srcNames.length;
  const sourcesSheet = dataSheet({
    name: 'Sources',
    table: 'SourcesTable',
    title: 'Where orders come from',
    note: `${FOLLOWS} Fully paid orders, by where the customer came from. Instagram, TikTok and Facebook are spotted automatically; WhatsApp comes from the link in Copy WhatsApp message.`,
    columns: [
      { h: 'Source', w: 20 },
      { h: 'Orders', w: 10, s: 'int', total: 'sum' },
      { h: 'Sales', w: 14, s: 'money', total: 'sum' },
      { h: 'Share of sales', w: 12, s: 'pct' },
    ],
    rows: srcNames.map((name, k) => {
      const row = 5 + k;
      const x = r.sources.find((y) => y.name === name) || { orders: 0, sales: 0 };
      const tot = sum(r.sources, (y) => y.sales);
      return [
        name,
        { f: `COUNTIFS(${O('F')},"="&$A${row},${inP(O('O'))},${O('P')},1)`, v: x.orders },
        { f: `SUMIFS(${O('I')},${O('F')},"="&$A${row},${inP(O('O'))},${O('P')},1)`, v: x.sales },
        { f: `IF(SUM($C$5:$C$${srcN})=0,0,C${row}/SUM($C$5:$C$${srcN}))`, v: tot ? x.sales / tot : 0 },
      ];
    }),
    charts: [
      {
        at: [5, 3, 13, 20],
        kind: 'bar',
        horizontal: true,
        title: 'Sales by source',
        cats: `Sources!$A$5:$A$${srcN}`,
        series: [{ name: 'Sales', ref: `Sources!$C$5:$C$${srcN}`, color: BLUE }],
      },
    ],
  });
  const areaNames = [
    ...new Set(orders.filter((o) => o.mode === 'delivery').map((o) => o.area || 'Not given')),
  ].sort((a, b) => {
    const x = (r.areas.find((y) => y.name === a) || { sales: 0 }).sales,
      y = (r.areas.find((z) => z.name === b) || { sales: 0 }).sales;
    return y - x || a.localeCompare(b);
  });
  const aN = 4 + Math.max(1, areaNames.length);
  const areasSheet = dataSheet({
    name: 'Areas',
    table: 'AreasTable',
    title: 'Where you deliver',
    note: `${FOLLOWS} Fully paid delivery orders, by the area the customer picked at checkout.`,
    columns: [
      { h: 'Area', w: 22 },
      { h: 'Orders', w: 10, s: 'int', total: 'sum' },
      { h: 'Sales', w: 14, s: 'money', total: 'sum' },
      { h: 'Share of sales', w: 12, s: 'pct' },
    ],
    rows: areaNames.map((name, k) => {
      const row = 5 + k;
      const x = r.areas.find((y) => y.name === name) || { orders: 0, sales: 0 };
      const tot = sum(r.areas, (y) => y.sales);
      return [
        name,
        { f: `COUNTIFS(${O('E')},"="&$A${row},${inP(O('O'))},${O('P')},1)`, v: x.orders },
        { f: `SUMIFS(${O('I')},${O('E')},"="&$A${row},${inP(O('O'))},${O('P')},1)`, v: x.sales },
        { f: `IF(SUM($C$5:$C$${aN})=0,0,C${row}/SUM($C$5:$C$${aN}))`, v: tot ? x.sales / tot : 0 },
      ];
    }),
    rules: [{ ref: `C5:C${aN}`, bar: '93C5FD' }],
  });
  const riderNames = [
    ...new Set(orders.filter((o) => o.rider_name && o.mode === 'delivery').map((o) => o.rider_name)),
  ].sort();
  const rN = 4 + Math.max(1, riderNames.length);
  const ridersSheet = dataSheet({
    name: 'Riders',
    table: 'RidersTable',
    title: 'Riders',
    note: `${FOLLOWS} Deliveries handed to each rider, and the delivery money customers paid for them.`,
    columns: [
      { h: 'Rider', w: 22 },
      { h: 'Deliveries', w: 11, s: 'int', total: 'sum' },
      { h: 'Delivery money', w: 15, s: 'money', total: 'sum' },
    ],
    rows: riderNames.map((name, k) => {
      const row = 5 + k;
      const x = r.riders.find((y) => y.name === name) || { deliveries: 0, deliveryMoney: 0 };
      return [
        name,
        { f: `COUNTIFS(${O('R')},"="&$A${row},${inP(O('Q'))},${O('G')},"Delivery")`, v: x.deliveries },
        {
          f: `SUMIFS(${O('J')},${O('R')},"="&$A${row},${inP(O('Q'))},${O('G')},"Delivery")`,
          v: x.deliveryMoney,
        },
      ];
    }),
  });

  // ---------- Owed (as it is now) ----------
  const owN = 4 + Math.max(1, r.owed.length);
  const owedSheet = dataSheet({
    name: 'Owed',
    table: 'OwedTable',
    title: 'Who owes you',
    note: `As it was when you downloaded this, oldest first. ${r.ageTotals.map((a) => `${a.age}: ${naira(a.amount)} (${a.count})`).join(' · ')}.`,
    columns: [
      { h: 'Order', w: 10 },
      { h: 'Customer', w: 22 },
      { h: 'Phone', w: 15 },
      { h: 'Placed', w: 21, s: 'datetime' },
      { h: 'Days', w: 7, s: 'int' },
      { h: 'Age', w: 13 },
      { h: 'Owes', w: 13, s: 'money', total: 'sum' },
      { h: 'Says they paid', w: 12 },
    ],
    rows: r.owed.map((o) => [
      {
        f: `HYPERLINK("https://shopdesk.com.ng/?order=${o.id}#orders","${orderCode(shop, o)}")`,
        v: orderCode(shop, o),
        s: 'link',
      },
      o.name,
      o.phone,
      X(o.created_at),
      o.days,
      o.age,
      o.owes,
      o.says ? 'Yes' : '',
    ]),
    rules: [{ ref: `E5:G${owN}`, when: '$E5>30', style: 'bad' }],
  });

  // ---------- Daily (the period on screen) and Monthly ----------
  // money out and "left" only appear for shops that note their spending (see report.js: hasOut)
  const hasOut = m.hasOut;
  const dN = 4 + Math.max(1, r.cashBook.length);
  const many = r.cashBook.length > 45;
  let runIn = 0;
  const dailySheet = dataSheet({
    name: 'Daily',
    table: 'DailyTable',
    title: `Day by day · ${period.fullMonth ? new Date(period.start).toLocaleDateString('en-NG', { month: 'long', year: 'numeric' }) : label[period.key] || 'Your dates'}`,
    note: hasOut
      ? 'Money in (your sales, without delivery fees), money out, and what was left each day. The running total adds up from the first day.'
      : 'Money in each day (your sales, without delivery fees). The running total adds up from the first day.',
    columns: [
      { h: 'Date', w: 15, s: 'day' },
      { h: 'Orders', w: 9, s: 'int', total: 'sum' },
      { h: 'Money in', w: 13, s: 'money', total: 'sum' },
      { h: 'Delivery money', w: 13, s: 'money', total: 'sum' },
      ...(hasOut
        ? [
            { h: 'Money out', w: 13, s: 'money', total: 'sum' },
            { h: 'Left', w: 13, s: 'money', total: 'sum' },
          ]
        : []),
      { h: 'Running total', w: 14, s: 'money' },
    ],
    rows: r.cashBook.map((d, k) =>
      hasOut
        ? [
            X(d.day + 'T00:00:00'),
            d.orders,
            d.moneyIn,
            d.delivery,
            d.moneyOut,
            { f: `C${5 + k}-E${5 + k}`, v: d.left },
            { f: k ? `G${4 + k}+F${5 + k}` : `F5`, v: d.balance },
          ]
        : [
            X(d.day + 'T00:00:00'),
            d.orders,
            d.moneyIn,
            d.delivery,
            { f: k ? `E${4 + k}+C${5 + k}` : `C5`, v: (runIn += d.moneyIn) },
          ],
    ),
    charts: [
      {
        at: [hasOut ? 8 : 6, 3, hasOut ? 18 : 16, 24],
        kind: many ? 'line' : 'bar',
        title: hasOut ? 'Money in and money out' : 'Money in each day',
        cats: `Daily!$A$5:$A$${dN}`,
        numCats: true,
        catFormat: 'd mmm',
        series: [
          { name: 'Money in', ref: `Daily!$C$5:$C$${dN}`, color: BLUE },
          ...(hasOut ? [{ name: 'Money out', ref: `Daily!$E$5:$E$${dN}`, color: RED }] : []),
        ],
      },
    ],
    rules: hasOut ? [{ ref: `F5:F${dN}`, when: '$F5<0', style: 'bad' }] : [],
  });
  const moN = 4 + Math.max(1, r.months.length);
  const monthlySheet = dataSheet({
    name: 'Monthly',
    table: 'MonthlyTable',
    title: 'Month by month',
    note: 'Every month since your first order (or since 1 January last year).',
    columns: [
      { h: 'Month', w: 16, s: 'month' },
      { h: 'Orders', w: 9, s: 'int', total: 'sum' },
      { h: 'Money in', w: 14, s: 'money', total: 'sum' },
      ...(hasOut
        ? [
            { h: 'Money out', w: 14, s: 'money', total: 'sum' },
            { h: 'Left', w: 14, s: 'money', total: 'sum' },
          ]
        : []),
      { h: 'Delivery money', w: 14, s: 'money', total: 'sum' },
    ],
    rows: r.months.map((x, k) =>
      hasOut
        ? [X(x.start), x.orders, x.moneyIn, x.moneyOut, { f: `C${5 + k}-D${5 + k}`, v: x.left }, x.delivery]
        : [X(x.start), x.orders, x.moneyIn, x.delivery],
    ),
    charts: [
      {
        at: [hasOut ? 7 : 5, 3, hasOut ? 18 : 16, 24],
        kind: 'bar',
        title: hasOut ? 'Money in, money out and what was left' : 'Money in each month',
        cats: `Monthly!$A$5:$A$${moN}`,
        numCats: true,
        catFormat: 'mmm yy',
        series: hasOut
          ? [
              { name: 'Money in', ref: `Monthly!$C$5:$C$${moN}`, color: BLUE },
              { name: 'Money out', ref: `Monthly!$D$5:$D$${moN}`, color: RED },
              { name: 'Left', ref: `Monthly!$E$5:$E$${moN}`, color: GREEN, kind: 'line' },
            ]
          : [{ name: 'Money in', ref: `Monthly!$C$5:$C$${moN}`, color: BLUE }],
      },
    ],
    rules: [{ ref: `C5:C${moN}`, bar: '93C5FD' }],
  });

  // ---------- When people order (the period on screen) ----------
  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const hourName = (h) => (h % 12 === 0 ? 12 : h % 12) + (h < 12 ? 'am' : 'pm');
  const heatSheet = {
    name: 'When people order',
    widths: [12, ...Array(24).fill(5.2), 8],
    rows: [
      [{ v: 'When people order', s: 'title' }],
      [
        {
          v: `Orders placed in ${String(label[period.key] || 'your dates').toLowerCase()}, by day and hour. Darker = busier: post your Status just before.`,
          s: 'note',
        },
      ],
      [],
      [
        { v: '', s: 'head' },
        ...Array.from({ length: 24 }, (_, h) => ({ v: hourName(h), s: 'head' })),
        { v: 'Total', s: 'head' },
      ],
      ...r.heat.map((row, d) => [
        { v: DAYS[d], s: 'bold' },
        ...row.map((v) => ({ v, s: 'heat' })),
        { f: `SUM(B${5 + d}:Y${5 + d})`, v: sum(row, (x) => x), s: 'intB' },
      ]),
    ],
    heights: { 0: 30 },
    freeze: { rows: 4, cols: 1 },
    rules: [{ ref: 'B5:Y11', scale: ['FFFFFF', '1D4ED8'] }],
  };

  // ---------- Lists (hidden): the choices in the Period box ----------
  const choices = periodChoices(r.months.length ? r.months[0].start : raw.since, now);
  const lN = 1 + choices.length;
  const lists = {
    name: 'Lists',
    hidden: true,
    widths: [22, 16, 16, 16, 16],
    rows: [
      ['Period', 'From', 'To', 'Before from', 'Before to'].map((v) => ({ v, s: 'bold' })),
      ...choices.map(([name, a, b, pa, pb]) => [
        name,
        ...[a, b, pa, pb].map((t) => (t == null ? '' : { v: X(t), s: 'datetime' })),
      ]),
    ],
  };

  // ---------- Summary ----------
  // a whole month (a monthly report) is picked by its name in the Period box, e.g. "October 2026"
  const chosen = period.fullMonth
    ? new Date(period.start).toLocaleDateString('en-NG', { month: 'long', year: 'numeric' })
    : label[period.key] || 'Your own dates';
  const customFrom = period.key === 'custom' ? X(period.start) : X(periodFor('7d', now).start);
  const customTo =
    period.key === 'custom' ? Math.floor(X(Math.min(period.finish - 1, now))) : Math.floor(X(now));
  const LIST = `Lists!$A$2:$E$${lN}`;
  const pick = (k, fallback) => `IF($B$4="Your own dates",${fallback},VLOOKUP($B$4,${LIST},${k},FALSE))`;
  const n = new Date(now);
  const kpi = (labelText, now1, before, f, fb, st = 'money') => [
    { v: labelText, s: labelText.startsWith('   ') ? 'text' : 'bold' },
    { f, v: now1, s: st === 'money' ? 'moneyB' : 'intB' },
    fb ? { f: fb, v: before, s: st === 'money' ? 'money' : 'int' } : { v: '', s: 'text' },
    null,
  ];
  const customersF = (S, E) => {
    const B = O('B'),
      K = O('S'),
      Nn = O('N');
    return `SUMPRODUCT((${B}>=${S})*(${B}<=${E})*(${Nn}<>"Cancelled")/(COUNTIFS(${K},${K},${B},">="&${S},${B},"<="&${E},${Nn},"<>Cancelled")+(((${B}<${S})+(${B}>${E})+(${Nn}="Cancelled"))>0)))`;
  };
  const measures = [
    kpi(
      'Sales (money in, without delivery fees)',
      s.income,
      s.prevIncome,
      `SUMIFS(${Pm('E')},${inP(Pm('A'))})`,
      `SUMIFS(${Pm('E')},${inPrev(Pm('A'))})`,
    ),
    kpi(
      'Orders',
      s.orders,
      s.prevOrders,
      `COUNTIFS(${inP(O('B'))},${O('N')},"<>Cancelled")`,
      `COUNTIFS(${inPrev(O('B'))},${O('N')},"<>Cancelled")`,
      'int',
    ),
    kpi(
      'Average order',
      s.avgOrder,
      s.prevAvgOrder,
      `IFERROR(ROUND(AVERAGEIFS(${O('I')},${inP(O('O'))},${O('P')},1),0),0)`,
      `IFERROR(ROUND(AVERAGEIFS(${O('I')},${inPrev(O('O'))},${O('P')},1),0),0)`,
    ),
    kpi(
      'Items sold',
      s.itemsSold,
      s.prevItemsSold,
      `SUMIFS(${I('D')},${inP(I('I'))},${I('J')},1)`,
      `SUMIFS(${I('D')},${inPrev(I('I'))},${I('J')},1)`,
      'int',
    ),
    kpi(
      'Customers',
      s.customers,
      s.prevCustomers,
      customersF('PeriodStart', 'PeriodEnd'),
      customersF('PrevStart', 'PrevEnd'),
      'int',
    ),
    kpi(
      'Orders placed (value)',
      m.orderValue,
      null,
      `SUMIFS(${O('I')},${inP(O('B'))},${O('N')},"<>Cancelled")`,
    ),
    kpi('   Paid', m.paidOnThese, null, 'B15-B17'),
    kpi('   Still owed', m.owedOnThese, null, `SUMIFS(${O('M')},${inP(O('B'))},${O('N')},"<>Cancelled")`),
    ...(hasOut
      ? [
          kpi(
            'Money out',
            m.spent,
            m.spentBefore,
            `SUMIFS(${M('D')},${M('A')},">="&INT(PeriodStart),${M('A')},"<="&PeriodEnd)`,
            `SUMIFS(${M('D')},${M('A')},">="&INT(PrevStart),${M('A')},"<="&PrevEnd)`,
          ),
          kpi('Left (money in − money out)', m.left, m.leftBefore, 'B10-B18', 'C10-C18'),
        ]
      : []),
    kpi('Delivery money for riders (not yours)', m.delivery, null, `SUMIFS(${Pm('F')},${inP(Pm('A'))})`),
    kpi('Discounts given on sale items', m.discounts, null, `SUMIFS(${I('G')},${inP(I('I'))},${I('J')},1)`),
    kpi(
      'Cancelled orders (value)',
      m.cancelledValue,
      null,
      `SUMIFS(${O('I')},${inP(O('B'))},${O('N')},"Cancelled")`,
    ),
  ].map((row, k) => {
    const rr = 10 + k;
    const before = row[2].v;
    row[3] = row[2].f
      ? {
          f: `IF(OR(C${rr}="",C${rr}=0),"",B${rr}/C${rr}-1)`,
          v: before ? row[1].v / before - 1 : '',
          s: 'change',
        }
      : { v: '', s: 'text' };
    return row;
  });
  measures[hasOut ? 9 : 0][1].s = 'moneyBig';
  const G = 12 + measures.length; // the goal's row; "in so far" is under it, then done, pace and needed

  const top = (sheet, keyCol, rankCol, cols, nLast, kk) =>
    cols.map((c) => ({
      f: `IFERROR(IF(INDEX(${sheet}!$${rankCol}$5:$${rankCol}$${nLast},MATCH(LARGE(${sheet}!$${rankCol}$5:$${rankCol}$${nLast},${kk}),${sheet}!$${rankCol}$5:$${rankCol}$${nLast},0))<0.001,"",INDEX(${sheet}!$${c}$5:$${c}$${nLast},MATCH(LARGE(${sheet}!$${rankCol}$5:$${rankCol}$${nLast},${kk}),${sheet}!$${rankCol}$5:$${rankCol}$${nLast},0))),"")`,
    }));
  const topProducts = r.products.filter((p) => p.sales > 0).slice(0, 5);
  const topCustomers = r.customers.filter((c) => c.periodSpent > 0).slice(0, 5);

  const side = []; // rows from 9 on, columns F to H
  side.push([
    { v: 'Top products', s: 'headL' },
    { v: 'Sold', s: 'head' },
    { v: 'Sales', s: 'head' },
  ]);
  for (let k = 1; k <= 5; k++) {
    const p = topProducts[k - 1];
    const [a, b, c] = top('Products', 'A', 'K', ['A', 'B', 'C'], prN, k);
    side.push([
      { ...a, v: p ? p.name : '' },
      { ...b, v: p ? p.qty : '', s: 'int' },
      { ...c, v: p ? p.sales : '', s: 'money' },
    ]);
  }
  side.push([]);
  side.push([
    { v: 'Top customers', s: 'headL' },
    { v: 'Orders', s: 'head' },
    { v: 'Spent', s: 'head' },
  ]);
  for (let k = 1; k <= 5; k++) {
    const c0 = topCustomers[k - 1];
    const [a, b, c] = top('Customers', 'A', 'L', ['A', 'D', 'E'], cN, k);
    side.push([
      { ...a, v: c0 ? c0.name : '' },
      { ...b, v: c0 ? c0.periodOrders : '', s: 'int' },
      { ...c, v: c0 ? c0.periodSpent : '', s: 'money' },
    ]);
  }
  side.push([]);
  side.push([
    { v: 'Where orders come from', s: 'headL' },
    { v: 'Orders', s: 'head' },
    { v: 'Sales', s: 'head' },
  ]);
  srcNames.forEach((name, k) => {
    const x = r.sources.find((y) => y.name === name) || { orders: 0, sales: 0 };
    side.push([
      { f: `Sources!A${5 + k}`, v: name },
      { f: `Sources!B${5 + k}`, v: x.orders, s: 'int' },
      { f: `Sources!C${5 + k}`, v: x.sales, s: 'money' },
    ]);
  });
  if (hasOut) {
    side.push([]);
    side.push([
      { v: 'Money out by kind', s: 'headL' },
      { v: '', s: 'head' },
      { v: 'Amount', s: 'head' },
    ]);
    OUT_KINDS.forEach(([kind, name]) => {
      const amt = (m.outByKind.find((x) => x.kind === kind) || { amount: 0 }).amount;
      side.push([
        name,
        '',
        {
          f: `SUMIFS(${M('D')},${M('B')},"="&F${9 + side.length},${M('A')},">="&INT(PeriodStart),${M('A')},"<="&PeriodEnd)`,
          v: amt,
          s: 'money',
        },
      ]);
    });
  }

  const summaryRows = [
    [{ v: `${shop.name} · Sales report`, s: 'title' }],
    [
      {
        v: `Made with ShopDesk on ${new Date(now).toLocaleString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}. Change the yellow Period box to see any other period: this sheet and every sheet marked ⟳ work themselves out again. Sales count when you tap Money in, without delivery fees.`,
        s: 'noteWrap',
      },
    ],
    [],
    [
      { v: 'Period', s: 'bold' },
      { v: chosen, s: 'input' },
      { v: '', s: 'input' },
      null,
      null,
      { v: 'Your own dates', s: 'bold' },
    ],
    [
      { v: 'From', s: 'text' },
      { f: pick(2, '$G$5'), v: X(period.start), s: 'dateB' },
      null,
      null,
      null,
      { v: 'From', s: 'text' },
      { v: customFrom, s: 'inputDate' },
    ],
    [
      { v: 'To', s: 'text' },
      {
        f: pick(3, '$G$6+0.99999'),
        v: X(period.key === 'custom' ? period.finish - 1 : period.end),
        s: 'dateB',
      },
      null,
      null,
      null,
      { v: 'To', s: 'text' },
      { v: customTo, s: 'inputDate' },
    ],
    [
      { v: 'Compared with', s: 'note' },
      { f: pick(4, '$G$5-($G$6-$G$5+1)'), v: X(period.prevStart), s: 'date' },
      { f: pick(5, '$G$5-0.00001'), v: X(period.prevEnd), s: 'date' },
      null,
      null,
      { v: 'Pick "Your own dates" in the Period box, then type your dates here.', s: 'note' },
    ],
    [],
    [
      { v: 'Measure', s: 'headL' },
      { v: 'This period', s: 'head' },
      { v: 'Before', s: 'head' },
      { v: 'Change', s: 'head' },
    ],
    ...measures,
    [],
    [
      { v: `This month's goal`, s: 'section' },
      { v: '', s: 'section' },
      { v: '', s: 'section' },
      { v: '', s: 'section' },
    ],
    [
      { v: 'Your goal for the month (type it here)', s: 'text' },
      { v: r.goal.amount || 0, s: 'inputMoney' },
    ],
    [
      { v: 'In so far this month', s: 'text' },
      {
        f: `SUMIFS(${Pm('E')},${Pm('A')},">="&DATE(YEAR(TODAY()),MONTH(TODAY()),1),${Pm('A')},"<"&TODAY()+1)`,
        v: r.goal.soFar,
        s: 'moneyB',
      },
    ],
    [
      { v: 'Done', s: 'text' },
      { f: `IF(B${G}=0,0,MIN(1,B${G + 1}/B${G}))`, v: r.goal.share, s: 'pctB' },
    ],
    [
      { v: 'At this pace the month ends on', s: 'text' },
      {
        f: `ROUND(B${G + 1}/DAY(TODAY())*DAY(EOMONTH(TODAY(),0)),0)`,
        v:
          r.goal.pace ??
          Math.round((r.goal.soFar / n.getDate()) * new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate()),
        s: 'moneyB',
      },
    ],
    [
      { v: 'Needed each day to reach the goal', s: 'text' },
      {
        f: `IF(B${G + 1}>=B${G},0,CEILING((B${G}-B${G + 1})/(DAY(EOMONTH(TODAY(),0))-DAY(TODAY())+1),100))`,
        v: r.goal.perDayNeeded,
        s: 'moneyB',
      },
    ],
  ];
  // the side tables sit in columns F to H from row 9
  side.forEach((cells, k) => {
    const row = (summaryRows[8 + k] = summaryRows[8 + k] || []);
    while (row.length < 5) row.push(null);
    row[5] = cells[0];
    row[6] = cells[1];
    row[7] = cells[2];
  });

  const summary = {
    name: 'Summary',
    widths: [40, 17, 17, 11, 3, 28, 12, 14],
    rows: summaryRows,
    heights: { 0: 32, 1: 46 },
    merges: ['A1:H1', 'A2:H2', 'B4:C4'],
    freeze: { rows: 3 },
    lists: [
      {
        ref: 'B4',
        source: LIST.replace('$E$', '$A$'),
        promptTitle: 'Period',
        prompt: 'Pick a period. Everything on this sheet and the ⟳ sheets follows it.',
      },
      { ref: 'G5:G6', type: 'date' },
    ],
    rules: [
      { ref: `B${G + 2}`, bar: '86EFAC', max: 1 },
      ...(hasOut ? [{ ref: 'B19', when: '$B$19<0', style: 'bad' }] : []),
      { ref: `D10:D${9 + measures.length}`, when: 'AND(ISNUMBER($D10),$D10>0)', style: 'good' },
      { ref: `D10:D${9 + measures.length}`, when: 'AND(ISNUMBER($D10),$D10<0)', style: 'bad' },
    ],
    charts: [
      {
        at: [0, G + 5, 4, G + 24],
        kind: 'bar',
        title: hasOut ? 'Month by month: money in and money out' : 'Month by month: money in',
        cats: `Monthly!$A$5:$A$${moN}`,
        numCats: true,
        catFormat: 'mmm yy',
        series: [
          { name: 'Money in', ref: `Monthly!$C$5:$C$${moN}`, color: BLUE },
          ...(hasOut ? [{ name: 'Money out', ref: `Monthly!$D$5:$D$${moN}`, color: RED }] : []),
        ],
      },
    ],
    tab: '111827',
  };

  return {
    names: {
      PeriodStart: 'Summary!$B$5',
      PeriodEnd: 'Summary!$B$6',
      PrevStart: 'Summary!$B$7',
      PrevEnd: 'Summary!$C$7',
    },
    sheets: [
      summary,
      { ...dailySheet, tab: '2563EB' },
      { ...monthlySheet, tab: '2563EB' },
      { ...productsSheet, tab: '16A34A' },
      { ...customersSheet, tab: '16A34A' },
      { ...sourcesSheet, tab: '16A34A' },
      { ...areasSheet, tab: '16A34A' },
      { ...ridersSheet, tab: '16A34A' },
      { ...owedSheet, tab: 'DC2626' },
      ordersSheet,
      itemsSheet,
      paymentsSheet,
      ...(hasOut ? [outSheet] : []),
      heatSheet,
      lists,
    ],
  };
}

export async function downloadSalesReport(r, shop, say, raw) {
  try {
    // "now" is the moment the numbers on screen were worked out, so the file and the app say the same thing
    const book = salesWorkbook(r, shop, raw || r.raw, r.period.key === 'custom' ? Date.now() : r.period.end);
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    await downloadXlsx(`${shop.slug}-sales-report-${stamp}.xlsx`, book);
    say('Excel report downloaded');
  } catch (e) {
    console.warn('ShopDesk Excel report:', e);
    say("The Excel file couldn't be made. Try again.");
  }
}
