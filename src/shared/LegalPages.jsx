// /legal: the list of ShopDesk's legal pages. /terms: the terms of use. /prohibited: what can't be sold on ShopDesk.
// The privacy notice and the shop and customer rules are on /privacy.
// Plain-language terms. Have them checked by a lawyer before relying on them in a dispute.
import React from 'react';
import { privacyEmail } from '../lib/database.js';
import { Page } from './Page.jsx';
import { MenuRow } from '../customer/AccountPage.jsx';

const UPDATED = '20 November 2026';
const contactEmail = () => privacyEmail || 'info@shopdesk.com.ng';

export function LegalPage() {
  return (
    <Page title="Legal" back="/account" kind="me">
      <nav className="card boxed menu" aria-label="Legal">
        <MenuRow href="/terms" icon="doc" label="Terms of Use" />
        <MenuRow href="/prohibited" icon="doc" label="Prohibited items" sub="What can't be sold on ShopDesk" />
        <MenuRow href="/privacy" icon="doc" label="Privacy notice" />
        <MenuRow href="/privacy#rules" icon="doc" label="Shop and customer rules" />
      </nav>
    </Page>
  );
}

export function TermsPage() {
  const email = contactEmail();
  return (
    <Page title="Terms of Use" back="/legal">
      <div className="legal stack">
        <p className="updated">Last updated {UPDATED}</p>
        <section className="card">
          <h2>1. About these terms</h2>
          <p className="note">
            ShopDesk is run by ShopDesk Technologies Limited, a company registered in Nigeria ("ShopDesk", "we").
            These terms apply to everyone who uses shopdesk.com.ng: people who buy ("customers") and people who sell
            ("shops"). By opening an account, placing an order or opening a shop, you agree to them, and to the{' '}
            <a href="/privacy#rules">shop and customer rules</a>, the <a href="/prohibited">prohibited items list</a>{' '}
            and the <a href="/privacy">privacy notice</a>.
          </p>
        </section>
        <section className="card">
          <h2>2. What ShopDesk does</h2>
          <p className="note">
            ShopDesk gives shops a page to sell from and tools to take orders, confirm payments, deliver and keep
            their accounts. Each sale is between the customer and the shop: the shop is the seller, sets its prices
            and is responsible for the goods and for delivering them. ShopDesk is not the seller.
          </p>
          <p className="note">
            When you pay by bank transfer, you pay the shop directly, into the account shown on your order.
            ShopDesk never receives or holds that money. Where ShopDesk offers paying online or ShopDesk Delivery,
            the price, any fees and who delivers are shown before you pay.
          </p>
          <p className="note">
            ShopDesk checks every new shop before it can take orders and can act on reports, but we can't check
            every product or promise that a shop will always do what it says.
          </p>
        </section>
        <section className="card">
          <h2>3. Your account</h2>
          <ul className="plain">
            <li>Use your own email and give true details. Keep access to your email safe: it is how you sign in.</li>
            <li>You must be 18 or older to open a shop.</li>
            <li>You are responsible for what happens on your account.</li>
            <li>
              You can stop using ShopDesk at any time. To delete your account, write to {email}. Records of past sales
              are kept as the <a href="/privacy">privacy notice</a> explains.
            </li>
          </ul>
        </section>
        <section className="card">
          <h2>4. Buying</h2>
          <ul className="plain">
            <li>Prices are set by each shop and are checked again when you place your order.</li>
            <li>
              Pay in full, only into the account shown on your order, within 48 hours. An order not paid by then
              cancels itself.
            </li>
            <li>Only tap "I've sent the money" after you've sent it.</li>
            <li>
              If something is wrong, report it on the order page within 3 days of delivery. The shop has 48 hours to
              sort it out; if it doesn't, ShopDesk can decide, as set out in the{' '}
              <a href="/privacy#problems">problem steps</a>.
            </li>
          </ul>
        </section>
        <section className="card">
          <h2>5. Selling</h2>
          <ul className="plain">
            <li>
              Follow the <a href="/privacy#rules">shop rules</a>, and sell nothing on the{' '}
              <a href="/prohibited">prohibited items list</a>.
            </li>
            <li>Describe and price your goods truthfully, and deliver what was paid for.</li>
            <li>Keep your bank details correct, and only ask customers to pay into the account on their order.</li>
            <li>Refund any order you cancel after being paid, and any refund ShopDesk decides, within 48 hours.</li>
            <li>Use customers' details only for their orders.</li>
            <li>You are responsible for the taxes and licences your business needs.</li>
          </ul>
        </section>
        <section className="card">
          <h2>6. Fees</h2>
          <p className="note">
            ShopDesk is free for customers and for shops: there is no monthly plan. If you pay online, or use
            ShopDesk Delivery, any card fee and ShopDesk fee are shown before you pay.
          </p>
        </section>
        <section className="card">
          <h2>7. Photos and words you add</h2>
          <p className="note">
            Shops keep ownership of their product photos and descriptions, and let ShopDesk show them on ShopDesk
            to sell their goods. Only add photos and words you have the right to use. Messages, photos and reports
            sent in a chat are kept with the order, as the <a href="/privacy">privacy notice</a> explains.
          </p>
        </section>
        <section className="card">
          <h2>8. When ShopDesk can step in</h2>
          <p className="note">
            We can remove a product, pause or close a shop, or block an account that breaks these terms or the
            rules, puts others at risk, or that the law requires us to act on. Where we can, we say why. A shop can
            talk to us about it in the ShopDesk chat.
          </p>
        </section>
        <section className="card">
          <h2>9. Responsibility</h2>
          <p className="note">
            ShopDesk works hard to keep the service running and safe, but it is provided as it is, and can sometimes
            be slow or unavailable. As far as the law allows, ShopDesk is not responsible for the goods shops sell,
            for deliveries made by a shop's own rider, or for money sent to an account other than the one on the
            order. Nothing in these terms takes away rights you have under Nigerian law, including the Federal
            Competition and Consumer Protection Act.
          </p>
        </section>
        <section className="card">
          <h2>10. Changes and the law</h2>
          <p className="note">
            We may update these terms. The date at the top shows the latest version, and we tell shops in the app
            about important changes. These terms are governed by the laws of the Federal Republic of Nigeria. If
            there is a disagreement, write to us first so we can try to settle it.
          </p>
        </section>
        <section className="card">
          <h2>11. Contact</h2>
          <p className="note">
            Questions about these terms: <a href={'mailto:' + email}>{email}</a>.
          </p>
        </section>
      </div>
    </Page>
  );
}

// what can't be sold, grouped so a shop can see quickly whether its goods are allowed
const BANNED = [
  ['Weapons', 'Guns, ammunition, explosives, fireworks, and knives or other items sold as weapons.'],
  [
    'Drugs and medicines',
    'Illegal drugs and anything for using them. Prescription medicines, unless you are a licensed pharmacy. Medicines, food, drinks and cosmetics that need NAFDAC registration and don’t have it.',
  ],
  ['Fake and stolen goods', 'Counterfeit or replica brands, pirated films, music, books or software, and stolen goods.'],
  [
    'Adult content',
    'Pornography and sexual services. Alcohol, tobacco and vapes may only be sold to people aged 18 or over.',
  ],
  ['Animals and wildlife', 'Protected or endangered animals, and anything made from them, such as ivory or pangolin scales.'],
  ['People', 'Human remains, organs, blood or body parts.'],
  [
    'Official items',
    'Government IDs, passports, licences or certificates, and police, military or other official uniforms and badges.',
  ],
  [
    'Money and accounts',
    'Loans, investments, "money doubling", betting, lottery and gambling, and bank accounts, cards, SIM cards or online accounts belonging to someone else.',
  ],
  ['Hacking and personal data', 'Hacking tools, malware, and lists of people’s personal details.'],
  ['Dangerous goods', 'Poisons, hazardous chemicals, and products recalled or banned for safety.'],
  ['Anything else illegal', 'Anything that is against the law in Nigeria, or that the law doesn’t allow you to sell.'],
];

export function ProhibitedPage() {
  return (
    <Page title="Prohibited items" back="/legal">
      <div className="legal stack">
        <p className="updated">Last updated {UPDATED}</p>
        <section className="card">
          <p className="note">
            These can't be listed or sold on ShopDesk. A shop that sells them has the products removed and can be
            paused or closed. This list is not complete: anything illegal in Nigeria is not allowed.
          </p>
        </section>
        <section className="card boxed faq">
          {BANNED.map(([what, detail]) => (
            <details key={what}>
              <summary>{what}</summary>
              <p>{detail}</p>
            </details>
          ))}
        </section>
        <section className="card">
          <p className="note">
            See something on ShopDesk that shouldn't be there? Open the shop and tap <strong>Report this shop</strong>{' '}
            at the bottom of its page.
          </p>
        </section>
      </div>
    </Page>
  );
}
