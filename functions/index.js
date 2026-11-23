// ==========================================================
// AI Law — Firebase Functions
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
// ==========================================================

import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { initializeApp } from 'firebase-admin/app';
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

initializeApp();

const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');
const OPENAI_API_KEY = defineSecret('OPENAI_API_KEY');
const MAIL_SECRET = defineSecret('MAIL_SECRET');

// Emails go out through the Chat Apps Script (MailApp), which already has
// permission to send from your Gmail
const MAIL_RELAY =
  'https://script.google.com/macros/s/AKfycbw1OhIw-0aAg_S0ARYvqp9xtfLp-EeNgOLMEjV32-O2wrUe1Dq8HIJXX5RsQWfRyX8V/exec';

// Sites allowed to call the chat
const ORIGINS = [/^http:\/\/localhost(:\d+)?$/, 'https://ailaw.llc', 'https://www.ailaw.llc'];

const ROUTES = {
  'chat:list': (caller) => listConversations(caller),
  'chat:get': (caller, data) => getConversation(caller, data),
  'chat:rename': (caller, data) => renameConversation(caller, data),
  'chat:delete': (caller, data) => deleteConversation(caller, data),
  'orders:list': (caller) => listMyOrders(caller),
  'admin:tasks': (caller) => adminTasks(requireAdmin(caller)),
  'admin:completeStep': (caller, data, env) => adminCompleteStep(requireAdmin(caller), data, env),
};

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
      signedIn: true,
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
