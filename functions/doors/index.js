// ==========================================================
// The doors and background jobs
//   client   the website: chat, profile, checkout, orders, documents,
//            services and blog pages
//   lawyer   joining as a lawyer, the Workspace: assignments, case chat,
//            documents, delivery, profile
//   admin    the admin pages
//   onOrderPaid  an order marked paid: receipt + its next steps
//   daily        retries what failed (folders, agreements, emails) and
//                moves paid orders on
//   declarationsBot  the 1% declarations Telegram bot: Telegram sends every
//                message here (webhook); /setup connects the bot to it
// Each door lists the plugin code it may load; switching a plugin off or on
// for a door is done in Firestore (Plugins/{id}: enabled, sides).
// ==========================================================

import { createHash } from 'node:crypto';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db, log } from '../core/app.js';
import { SECRETS, botToken, door } from '../core/door.js';
import { loadPlugins } from '../core/loader.js';
import { docs } from '../core/records.js';
import { advance, resumePaid } from '../core/steps.js';
import accounts from '../plugins/accounts/index.js';
import adminAssistant from '../plugins/admin-assistant/index.js';
import assignments from '../plugins/assignments/index.js';
import blog from '../plugins/blog/index.js';
import catalogue from '../plugins/catalogue/index.js';
import documents from '../plugins/documents/index.js';
import lawyerProfile from '../plugins/lawyer-profile/index.js';
import lawyerVerification from '../plugins/lawyer-verification/index.js';
import myOrders from '../plugins/my-orders/index.js';
import ordering, { sendReceipt, setupOrder } from '../plugins/ordering/index.js';
import declarations, { handleUpdate } from '../plugins/small-business-declarations/index.js';
import { setWebhook } from '../plugins/small-business-declarations/telegram-api.js';
import taskDesk from '../plugins/task-desk/index.js';

const CLIENT = [accounts, catalogue, ordering, myOrders, documents, blog, declarations];
const LAWYER = [lawyerVerification, assignments, lawyerProfile];
const ADMIN = [accounts, catalogue, ordering, lawyerVerification, taskDesk, blog, declarations, adminAssistant];

export const client = door('client', CLIENT);
// Applications carry their documents: up to ~25 MB per request
export const lawyer = door('lawyer', LAWYER, { memory: '1GiB' });
export const admin = door('admin', ADMIN);

// Background jobs get the same secrets, without a web request
function jobEnvironment() {
  return {
    keys: { gemini: SECRETS.gemini.value(), openai: SECRETS.openai.value() },
    secrets: { mailSecret: SECRETS.mailSecret.value(), smtpPassword: SECRETS.smtpPassword.value() },
    telegramToken: botToken(),
    origin: 'https://www.ailaw.llc',
  };
}

// ---------- Paid ----------

export const onOrderPaid = onDocumentUpdated(
  {
    document: 'Orders/{orderNumber}',
    database: 'ailaw',
    region: 'europe-west1',
    secrets: Object.values(SECRETS),
  },
  async (event) => {
    const before = event.data.before.data();
    const after = event.data.after.data();
    if (before.paymentStatus === 'paid' || after.paymentStatus !== 'paid') return;

    const env = jobEnvironment();
    await loadPlugins('client', CLIENT);
    const ref = event.data.after.ref;
    // Paid in the console by hand: the order page's own changes, done here
    const changes = {};
    if (!after.paidAt) changes.paidAt = new Date();
    if (after.orderStatus === 'placed') changes.orderStatus = 'in_progress';
    if (Object.keys(changes).length) await ref.update({ ...changes, updatedAt: new Date() });

    try {
      await sendReceipt({ ...after, ...changes }, env);
    } catch (err) {
      await log('receipt ' + after.orderNumber, err);
    }
    try {
      await advance(after.orderNumber, env);
    } catch (err) {
      await log('advance ' + after.orderNumber, err);
    }
  },
);

// ---------- Daily ----------

export const daily = onSchedule(
  {
    schedule: 'every day 06:00',
    timeZone: 'Asia/Tbilisi',
    region: 'europe-west1',
    secrets: Object.values(SECRETS),
    timeoutSeconds: 540,
  },
  async () => {
    const env = jobEnvironment();
    await loadPlugins('client', CLIENT);
    const open = docs(await db.collection('Orders').where('orderStatus', 'in', ['placed', 'in_progress']).get());
    for (const order of open) {
      if (order.folder?.startsWith('drive:')) continue;
      if (order.folder && order.agreement && order.emailedAt) continue;
      try {
        await setupOrder(order.orderNumber, env);
      } catch (err) {
        await log('daily setup ' + order.orderNumber, err);
      }
    }
    await resumePaid(env);
  },
);

// ---------- 1% declarations Telegram bot ----------

const BOT_URL = 'https://europe-west1-website-ai-law.cloudfunctions.net/declarationsBot';

// Telegram signs every call with this (derived from the token, so there is
// no second secret to keep)
const webhookSecret = (token) => createHash('sha256').update('ailaw-declarations:' + token).digest('hex').slice(0, 48);

export const declarationsBot = onRequest(
  { region: 'europe-west1', secrets: Object.values(SECRETS), timeoutSeconds: 60, memory: '512MiB' },
  async (req, res) => {
    const token = botToken();
    if (!token) {
      res.status(503).send('No bot connected');
      return;
    }
    // GET …/declarationsBot?setup=<secret> points the bot at this function
    if (req.method === 'GET') {
      if (req.query.setup !== webhookSecret(token)) {
        res.status(404).send('');
        return;
      }
      await setWebhook(token, BOT_URL, webhookSecret(token));
      res.send('Webhook set');
      return;
    }
    if (req.get('X-Telegram-Bot-Api-Secret-Token') !== webhookSecret(token)) {
      res.status(403).send('');
      return;
    }
    try {
      await handleUpdate(req.body || {}, jobEnvironment());
    } catch (err) {
      await log('declarationsBot', err);
    }
    // Always 200, so Telegram doesn't send the same update again
    res.send('ok');
  },
);
