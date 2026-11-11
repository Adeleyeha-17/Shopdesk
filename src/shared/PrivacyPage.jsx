// /privacy: the privacy notice and the shop rules, in plain words.
import React from 'react';
import { privacyEmail } from '../lib/database.js';
import { Page } from './Page.jsx';
import { lastShop } from '../customer/lastShop.js';

// Plain-language notice. Have it checked by a lawyer before a public launch (Nigeria Data Protection Act 2023).
export function PrivacyPage() {
  const contact = privacyEmail || 'the ShopDesk owner';
  return (
    // Back: the page they came from, or the shop they were last in
    <Page title="Privacy and rules" back={lastShop() ? '/' + lastShop().slug : '/'}>
      <section className="card">
        <h2>Privacy notice</h2>
        <p className="note">
          <strong>What we keep.</strong> When you order, the shop receives your name, phone number, delivery
          address and what you ordered. Shops sign in with an email address. If you make an account, we keep
          your email, your order history and the details you choose to save; you can delete your saved details
          any time from My orders.
        </p>
        <p className="note">
          <strong>Deliveries.</strong> When your order goes out, you see the rider's name and phone number so
          you can reach them. It's hidden again two days after delivery. We never track where you are.
        </p>
        <p className="note">
          <strong>Chat and alerts.</strong> Messages you send in an order's chat are kept with the order and
          can't be edited or deleted. ShopDesk reads a chat when a problem or report about that order comes to
          us, or, with a recorded reason, to check a complaint or stop fraud. If you turn on alerts, we keep
          your phone's alert address until you sign out. If you haven't opened ShopDesk for 10 minutes after
          something happens, we email you what you missed, at most once every 30 minutes; every email has a
          link to stop them.
        </p>
        <p className="note">
          <strong>Why.</strong> Only to take, deliver and settle your order, and to stop fraud. We don't sell
          data and the order pages have no advertising trackers.
        </p>
        <p className="note">
          <strong>Who sees it.</strong> The shop you ordered from. ShopDesk staff see counts and shop details,
          not your details, unless a shop asks for help with an order or a report needs checking. Each time
          that happens it's recorded with the reason.
        </p>
        <p className="note">
          <strong>How long.</strong> Your name, phone number, address and map pin are removed from closed
          orders after about six months. The record that a sale happened stays for the shop's accounts. If a
          shop is removed, ShopDesk keeps a private copy of its orders and chats to settle disputes and stop
          fraud.
        </p>
        <p className="note">
          <strong>Your rights.</strong> You can ask to see, correct or delete your details. Write to {contact}
          . If your details are ever exposed, the Nigeria Data Protection Commission is told within 72 hours,
          as the law requires.
        </p>
      </section>
      <section className="card" id="rules">
        <h2>Shop rules</h2>
        <ol className="steps">
          <li>Sell real goods you have or can get, at the price shown.</li>
          <li>Don't take money without delivering. Refund any cancelled order.</li>
          <li>Use customers' details only for their orders. Don't add them to broadcasts without asking.</li>
          <li>Nothing illegal, counterfeit or dangerous.</li>
          <li>Keep your account details correct so customers pay the right person.</li>
          <li>Only ask customers to pay into the account on their order.</li>
          <li>
            When ShopDesk decides a refund, pay it within 48 hours and add the transfer receipt, or your page
            pauses until you do.
          </li>
          <li>
            Tell customers why you cancel. Don't cancel an order the customer says is paid without checking.
          </li>
          <li>Be respectful in chat. No insults, threats or pressure.</li>
        </ol>
        <p className="note">
          Shops that break these rules can be suspended or removed. Customers can report a shop from its order
          page, or report a message in the chat.
        </p>
      </section>
      <section className="card" id="customers">
        <h2>Customer rules</h2>
        <ol className="steps">
          <li>Be respectful in chat. No insults, threats or pressure.</li>
          <li>Report real problems only, with a photo when something is wrong or missing.</li>
          <li>Only tap "I've sent the money" after you've sent it.</li>
          <li>Pay within 48 hours or cancel. Unpaid orders cancel themselves.</li>
        </ol>
        <p className="note">
          Customers who break these rules can have reporting paused or their account blocked. Shops can report
          a message in the chat.
        </p>
      </section>
    </Page>
  );
}
