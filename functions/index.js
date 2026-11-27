// ==========================================================
// AI Law — Firebase Functions
//
// The new backend (core + plugins + doors, on Firestore and Storage):
//   client, lawyer, admin, onOrderPaid, daily — see doors/index.js
// The functions below (chat, on Google Sheets) keep the current site
// working until the website switches to the doors; then they go.
//
// chat: the chat backend (moved here from Apps Script so answers can stream).
//   POST { action, idToken | guestId, data }
//   - "chat:send" streams newline-separated JSON events:
//       start → text… / part… → done   (or error)
//   - every other action answers once with { ok, data } or { ok: false, error }
//
// Secrets (firebase functions:secrets:set NAME):
//   GEMINI_API_KEY   Google AI Studio key   (Settings: Provider = gemini)
//   OPENAI_API_KEY   OpenAI key             (Settings: Provider = openai)
//   MAIL_SECRET      shared with the Chat Apps Script, which sends the emails
//
// Staff (lawyers) carry { staff: true, lawyerId } on their Firebase login,
// set when the admin approves their application (staff.js).
// ==========================================================

import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { ApiError } from './ai.js';
import {
  adminCompleteStep,
  adminTasks,
  deleteConversation,
  findUser,
  getConversation,
  listConversations,
  listMyOrders,
  renameConversation,
  sendMessage,
} from './engine.js';
import {
  adminApproveLawyer,
  adminLawyers,
  adminRejectLawyer,
  staffAssignments,
  staffMe,
} from './staff.js';

if (!getApps().length) initializeApp();

const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');
const OPENAI_API_KEY = defineSecret('OPENAI_API_KEY');
const MAIL_SECRET = defineSecret('MAIL_SECRET');

// Emails go out through the Chat Apps Script (MailApp), which already has
// permission to send from your Gmail
const MAIL_RELAY =
  'https://script.google.com/macros/s/AKfycbz6eb8HgMdSWWl_5eoEguD_muPHZDcvuJq02bWZI3OQyo4b_f9rXF9ck1-7hISr-yfO7g/exec';

// Sites allowed to call the chat
const ORIGINS = [
  /^http:\/\/localhost(:\d+)?$/,
  'https://ailaw.llc',
  'https://www.ailaw.llc',
  'https://del-po.github.io',
];

const ROUTES = {
  'chat:list': (caller) => listConversations(caller),
  'chat:get': (caller, data) => getConversation(caller, data),
  'chat:rename': (caller, data) => renameConversation(caller, data),
  'chat:delete': (caller, data) => deleteConversation(caller, data),
  'orders:list': (caller, data, env) => listMyOrders(caller, env),
  'admin:tasks': (caller, data, env) => adminTasks(requireAdmin(caller), env),
  'admin:completeStep': (caller, data, env) => adminCompleteStep(requireAdmin(caller), data, env),
  'admin:lawyers': (caller) => adminLawyers(requireAdmin(caller)),
  'admin:approveLawyer': (caller, data, env) => adminApproveLawyer(requireAdmin(caller), data, env),
  'admin:rejectLawyer': (caller, data, env) => adminRejectLawyer(requireAdmin(caller), data, env),
  'staff:me': (caller) => staffMe(requireStaff(caller)),
  'staff:assignments': (caller) => staffAssignments(requireStaff(caller)),
};

// Links in emails (e.g. the lawyer's invite) lead back to the site the
// request came from: localhost while testing, www.ailaw.llc when live
const SITE = 'https://www.ailaw.llc';
function siteOrigin(req) {
  const origin = String(req.headers.origin || '');
  return ORIGINS.some((o) => (o instanceof RegExp ? o.test(origin) : o === origin))
    ? origin
    : SITE;
}

export const chat = onRequest(
  {
    region: 'europe-west1',
    cors: ORIGINS,
    secrets: [GEMINI_API_KEY, OPENAI_API_KEY, MAIL_SECRET],
    timeoutSeconds: 120,
    memory: '512MiB',
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
      return;
    }

    const body = typeof req.body === 'string' ? safeJson(req.body) : req.body || {};
    const env = {
      keys: { gemini: GEMINI_API_KEY.value(), openai: OPENAI_API_KEY.value() },
      sendMail: (mail) => sendMail(mail, MAIL_SECRET.value()),
      origin: siteOrigin(req),
    };

    // ---------- Streamed answer ----------
    if (body.action === 'chat:send') {
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      const emit = (event) => res.write(JSON.stringify(event) + '\n');

      try {
        const caller = await identify(body.idToken, body.guestId);
        await sendMessage(caller, body.data || {}, emit, env);
      } catch (err) {
        if (!err.code) console.error(err);
        emit({ type: 'error', error: err.code || 'SERVER_ERROR' });
      }
      res.end();
      return;
    }

    // ---------- Everything else ----------
    try {
      const route = ROUTES[body.action];
      if (!route) throw new ApiError('UNKNOWN_ACTION');
      const caller = await identify(body.idToken, body.guestId);
      res.json({ ok: true, data: await route(caller, body.data || {}, env) });
    } catch (err) {
      if (!err.code) console.error(err);
      res.json({ ok: false, error: err.code || 'SERVER_ERROR' });
    }
  },
);

// ==========================================================
// Who is asking
// Signed-in users are identified by their Firebase token; visitors by a
// random id their browser keeps. Guests can ask questions but not order.
// ==========================================================

async function identify(idToken, guestId) {
  if (idToken) {
    let account;
    try {
      account = await getAuth().verifyIdToken(idToken);
    } catch {
      throw new ApiError('AUTH_REQUIRED');
    }
    const user = await findUser(account.uid);
    const status = String(user?.Status || '').toLowerCase();
    if (status === 'suspended') throw new ApiError('ACCOUNT_SUSPENDED');

    return {
      ownerId: account.uid,
      uid: account.uid,
      email: account.email || '',
      name: user?.DisplayName || account.name || '',
      isAdmin: !!user && user.Role === 'admin' && status === 'active',
      isStaff: account.staff === true,
      lawyerId: account.lawyerId || '',
      signedIn: true,
      // Passed on to the Orders Apps Script, which places chat orders as this client
      idToken,
    };
  }

  if (guestId && /^[a-zA-Z0-9-]{8,64}$/.test(guestId)) {
    return { ownerId: 'guest:' + guestId, signedIn: false, isAdmin: false };
  }

  throw new ApiError('AUTH_REQUIRED');
}

function requireAdmin(caller) {
  if (!caller.isAdmin) throw new ApiError('FORBIDDEN');
  return caller;
}

function requireStaff(caller) {
  if (!caller.isStaff || !caller.lawyerId) throw new ApiError('FORBIDDEN');
  return caller;
}

async function sendMail(mail, secret) {
  try {
    const res = await fetch(MAIL_RELAY, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'mail:send', secret, data: mail }),
    });
    const result = safeJson(await res.text());
    if (!result.ok) console.error('Mail relay refused: ' + result.error);
  } catch (err) {
    // A missed email must not break the order itself
    console.error('Mail relay failed', err);
  }
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export { admin, client, daily, lawyer, onOrderPaid } from './doors/index.js';
