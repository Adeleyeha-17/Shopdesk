// Browser tests on a phone-sized screen, against the demo build (demo/dist): the real app with the in-browser
// sample database, so nothing here touches live data.
//   npm run build:demo && npm run test:e2e
// Each step prints PASS or FAIL. A failing step saves a screenshot to tests/e2e/out/ and the run exits with 1.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../demo/dist');
const out = path.join(here, 'out');
const photo = path.join(here, 'fixtures/product.jpg');
const KEY = 'shopdesk-demo-v9';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json' };

if (!fs.existsSync(path.join(root, 'demo/index.html'))) {
  console.error('demo/dist is missing. Run npm run build:demo first.');
  process.exit(1);
}
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const url = `${origin}/demo/index.html`;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, timezoneId: 'Africa/Lagos' });
const p = await context.newPage();
const pageErrors = [];
p.on('pageerror', (e) => pageErrors.push(e.message));
p.setDefaultTimeout(8000);

let failures = 0;
let n = 0;
async function step(name, fn) {
  n++;
  try {
    await fn();
    console.log(`PASS  ${name}`);
  } catch (e) {
    failures++;
    console.log(`FAIL  ${name}\n      ${String(e.message || e).split('\n')[0]}`);
    await p.screenshot({ path: path.join(out, `${String(n).padStart(2, '0')}-failed.png`), fullPage: true }).catch(() => {});
  }
}
const expect = (ok, what) => {
  if (!ok) throw new Error(what);
};
const pause = (ms) => p.waitForTimeout(ms);
const text = async () => (await p.locator('body').innerText()).replace(/\s+/g, ' ');
async function see(t) {
  await p.getByText(t, { exact: false }).first().waitFor();
}
async function as(who) {
  await p.getByRole('button', { name: who, exact: true }).click();
  await pause(500);
  await p.locator('button:has-text("Not now")').first().click({ timeout: 1000 }).catch(() => {});
}
// change the demo's saved state, then reload: used where the demo bar has no button for it
async function patch(fn, where) {
  await pause(400);
  await p.evaluate(
    ([key, src, where]) => {
      const S = JSON.parse(localStorage.getItem(key));
      new Function('return ' + src)()(S);
      if (where) S.path = where;
      localStorage.setItem(key, JSON.stringify(S));
    },
    [KEY, fn.toString(), where || null],
  );
  await p.reload();
  await p.locator('.demo-bar').waitFor();
  await p.locator('button:has-text("Not now")').first().click({ timeout: 1000 }).catch(() => {});
}
const nav = (label) => p.locator(`nav >> text=${label}`).click();
let code = '';
const card = () => p.locator(`article.card:has-text("${code}")`).first();

await p.goto(url);
await p.locator('.demo-bar').waitFor();
await p.evaluate((key) => localStorage.removeItem(key), KEY);
await p.reload();
await p.locator('.demo-bar').waitFor();

// ---------------- customer: shop, sizes, cart, checkout ----------------
await step('the shop page lists products with prices', async () => {
  await as('Customer');
  await p.locator('.pcard').first().waitFor();
  expect((await p.locator('.pcard').count()) >= 5, 'fewer than 5 products shown');
  expect(/₦\d/.test(await text()), 'no prices shown');
});

await step('a product with sizes opens the size picker, and tapping a size row adds it', async () => {
  await p.locator('.pcard:has(.pname:text-is("Hair growth oil")) button[data-inc]').click();
  const row = p.locator('.optpick li').nth(1);
  await row.waitFor();
  await row.locator('strong').click();
  expect((await row.locator('.qty').innerText()).trim() === '1', 'tapping the row did not add one');
  const box = await p.locator('.modal.sheet').boundingBox();
  expect(box.x >= 0 && box.x + box.width <= 390, 'the size picker is wider than the screen');
  await p.locator('.sheet button:has-text("Done")').click();
});

await step('adding a second product puts 2 on the cart button at the top', async () => {
  await p.locator('.pcard:not(:has(.pname:text-is("Hair growth oil"))) button[data-inc]').first().click();
  await p.locator('.iconbtn .count').waitFor();
  expect((await p.locator('.iconbtn .count').innerText()).trim() === '2', 'the cart button does not show 2');
  expect((await p.locator('.cartbar').count()) === 0, 'the old bottom cart bar is still there');
});

await step('the cart button opens the cart page, which goes to checkout', async () => {
  await p.locator('a.iconbtn[href$="/cart"]').click();
  await see('Your cart');
  expect((await p.locator('.cart-line').count()) === 2, 'the cart page does not list 2 lines');
  await p.locator('button:has-text("Checkout")').click();
  await see('Place order');
});

await step('placing an order shows the order code and waits for the shop', async () => {
  await p.locator('button.choice').first().click();
  await p.locator('button:has-text("Place order")').click();
  await see('Waiting for the shop');
  code = (await text()).match(/Order ([A-Z]{2,4}-\d+)/)[1];
});

await step("the shop's name at the top goes back to the shop", async () => {
  await p.locator('a.brand').click();
  await p.locator('.pcard').first().waitFor();
  expect((await p.locator('.page-foot').innerText()).includes('Report this shop'), 'Report this shop is not in the footer');
});

// ---------------- shop owner: confirm ----------------
await step('the shop owner sees the new order and confirms it with a delivery fee', async () => {
  await as('Shop owner');
  await nav('Orders');
  await p.locator('.filter:has-text("Not paid")').click();
  await card().waitFor();
  await card().locator('input').first().fill('1500');
  await card().locator('button:has-text("Confirm order")').click();
  await see('confirmed');
});

// ---------------- customer: pay ----------------
await step('the customer sees the total and says they have paid', async () => {
  await as('Customer');
  await p.locator('a:has-text("My orders")').click();
  await p.locator(`a:has-text("${code}")`).click();
  await see('Account number');
  await p.locator('button:has-text("sent the money")').click();
  await see('The shop is told');
});

// ---------------- shop owner: money in, pack, rider ----------------
await step('the shop owner marks the money in', async () => {
  await as('Shop owner');
  await nav('Orders');
  await p.locator('.filter:has-text("Not paid")').click();
  await card().locator('button:has-text("Money in")').click();
  await see('Paid');
});

await step('the shop owner packs the order and hands it to a rider', async () => {
  await p.locator('.filter:has-text("To send")').click();
  const c = card();
  await c.waitFor();
  const ticks = c.locator('label:has-text("Packed")');
  for (let i = 0; i < (await ticks.count()); i++) await ticks.nth(i).click();
  await c.locator('button:has-text("Hand to rider")').first().click();
  await c.getByLabel("Rider's name").fill('Kola Ade');
  await c.getByLabel("Rider's phone number").fill('08031234567');
  await c.locator('button:has-text("Hand to rider")').last().click();
  await see('is with Kola Ade');
});

// ---------------- customer: delivered ----------------
await step('the customer sees the rider and confirms delivery', async () => {
  await as('Customer');
  await p.locator('a:has-text("My orders")').click();
  await p.locator(`a:has-text("${code}")`).click();
  await see('Kola Ade');
  await p.locator('button:has-text("I got everything")').click();
  await see('Delivered');
});

await step('the round badge on My orders opens Account, which shows who is signed in, and leads back', async () => {
  await p.locator('a:has-text("My orders")').first().click();
  const badge = p.locator('a.avatar');
  await badge.waitFor();
  const letter = (await badge.innerText()).trim();
  await badge.click();
  await see('Signed in as');
  const email = (await p.locator('.profile strong').innerText()).trim();
  expect(email.includes('@'), 'no email on the Account page');
  expect(letter === email[0].toUpperCase(), `the badge shows "${letter}", not the first letter of ${email}`);
  await see('Your details');
  await p.locator('.top-row a:has-text("My orders")').click();
  await p.locator('a.avatar').waitFor();
  await see('Past orders');
});

// ---------------- shop owner: products ----------------
const NAME = 'Test serum';
await step('the shop owner adds a product with two sizes', async () => {
  await as('Shop owner');
  await nav('Stock');
  await p.locator('button:has-text("Add a product")').click();
  await p.setInputFiles('#pPhoto-new', photo);
  await p.locator('#pName-new').fill(NAME);
  await p.locator('button.choice:has-text("Different sizes or colours")').click();
  const rows = [['30ml', '9500', '6'], ['50ml', '14000', '4']];
  for (let i = 0; i < rows.length; i++) {
    const r = p.locator('.optrow').nth(i).locator('input');
    await r.nth(0).fill(rows[i][0]);
    await r.nth(1).fill(rows[i][1]);
    await r.nth(3).fill(rows[i][2]);
  }
  await p.locator('button:has-text("Add product")').click();
  await see(`${NAME} added`);
  await p.locator(`section.card:has(strong:text-is("${NAME}"))`).waitFor();
});

await step('the shop owner edits the product', async () => {
  const c = p.locator(`section.card:has(strong:text-is("${NAME}"))`);
  await c.locator('button:has-text("Edit")').click();
  const name = p.locator('input[id^="pName-"]').first();
  await name.fill(NAME + ' 2');
  await p.locator('button:has-text("Save changes")').click();
  await see(`${NAME} 2 saved`);
});

await step('the shop owner deletes the product', async () => {
  const c = p.locator(`section.card:has(strong:text-is("${NAME} 2"))`);
  await c.locator('button:has-text("Delete")').click();
  await c.locator('.confirm-del button:has-text("Delete for good")').click();
  await see(`${NAME} 2 deleted`);
  await p.locator(`section.card:has(strong:text-is("${NAME} 2"))`).waitFor({ state: 'detached' }).catch(() => {
    throw new Error('the product is still listed');
  });
});

await step('the Sales page opens', async () => {
  await nav('Sales');
  await p.locator('h2').first().waitFor();
  expect(/₦/.test(await text()), 'no money figures on the Sales page');
});

// ---------------- a new shop owner signs up ----------------
await step('a new shop owner can sign up, type a link name with a dash, and send the shop for approval', async () => {
  await patch((S) => {
    S.uid = null;
  }, '/');
  await p.locator('#email').fill('newshop@example.com');
  await p.locator('button:has-text("Email me a code")').click();
  await p.locator('#code').pressSequentially('123456');
  await p.locator('#sName').waitFor();
  await p.locator('#sName').fill('Ada Fabrics');
  await p.locator('#sSlug').fill('');
  await p.locator('#sSlug').pressSequentially('ada-fabrics');
  expect((await p.locator('#sSlug').inputValue()) === 'ada-fabrics', 'the dash in the link name was removed while typing');
  await p.locator('#sNum').fill('0123456789');
  await p.locator('#sAcct').fill('ADA OKAFOR');
  await p.locator('#sWa').fill('08000000000');
  await p.locator('#sSells').fill('Fabrics');
  await p.locator('#sLoc').fill('Yaba, Lagos');
  await p.locator('label.agree').click();
  await p.locator('button:has-text("Send my shop for approval")').click();
  await see('Waiting for approval');
});

await step('no errors in the page', async () => {
  expect(pageErrors.length === 0, 'page errors: ' + pageErrors.join(' | '));
});

await browser.close();
server.close();
console.log(failures ? `\n${failures} of ${n} steps failed.` : `\nAll ${n} steps passed.`);
process.exit(failures ? 1 : 0);
