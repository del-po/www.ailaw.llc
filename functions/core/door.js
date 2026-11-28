// ==========================================================
// Core: a door
// One entrance per side (client, lawyer, admin). Every door works the same:
//   POST { action, idToken | guestId, data }
//   - "chat:send" streams newline-separated JSON events
//   - every other action answers once: { ok, data } or { ok: false, error }
//   GET ?action=…&… for public reads (services, blog)
// The guard decides who may come in; the door's plugins decide what it can do.
// The admin door records every change it makes in AuditLog (core/audit.js).
// Actions are plain handlers (caller, data, env, body), or objects:
//   { public: true, run }  no login at all (service list, blog, applying)
//   { guest: true, run }   a visitor's guest id is enough
// ==========================================================

import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { ApiError, log } from './app.js';
import { allowed, identify } from './guard.js';
import { actionsOf, loadPlugins } from './loader.js';
import { actionRoutes } from './chat-actions.js';
import { audited } from './audit.js';
import {
  answer,
  deleteConversation,
  getConversation,
  listConversations,
  renameConversation,
} from './chat.js';

export const SECRETS = {
  gemini: defineSecret('GEMINI_API_KEY'),
  openai: defineSecret('OPENAI_API_KEY'),
  mailSecret: defineSecret('MAIL_SECRET'),
  smtpPassword: defineSecret('SMTP_PASSWORD'),
  // The 1% declarations Telegram bot ("unset" until a bot is connected)
  declarationsBot: defineSecret('DECLARATIONS_BOT_TOKEN'),
};

// Sites allowed to call the doors
const ORIGINS = [
  /^http:\/\/localhost(:\d+)?$/,
  'https://ailaw.llc',
  'https://www.ailaw.llc',
  'https://del-po.github.io',
];

export function environment(req) {
  return {
    keys: { gemini: SECRETS.gemini.value(), openai: SECRETS.openai.value() },
    secrets: { mailSecret: SECRETS.mailSecret.value(), smtpPassword: SECRETS.smtpPassword.value() },
    telegramToken: botToken(),
    origin: siteOrigin(req),
  };
}

// The declarations bot's token, or '' while none is connected
export function botToken() {
  const token = String(SECRETS.declarationsBot.value() || '').trim();
  return token && token !== 'unset' ? token : '';
}

// side: 'client' | 'lawyer' | 'admin'; modules: the plugin code this door may load.
// A plugin may give the door a chat scope: chatScope(caller, data) → scope or null
export function door(side, modules, options = {}) {
  const chatScope = modules.find((m) => m.chatScope)?.chatScope;
  return onRequest(
    {
      region: 'europe-west1',
      cors: ORIGINS,
      secrets: Object.values(SECRETS),
      timeoutSeconds: 120,
      memory: '512MiB',
      ...options,
    },
    async (req, res) => {
      const body =
        req.method === 'GET'
          ? { action: req.query.action, data: { ...req.query } }
          : typeof req.body === 'string'
            ? safeJson(req.body)
            : req.body || {};
      const env = environment(req);

      // ---------- Streamed answer ----------
      if (body.action === 'chat:send') {
        res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        const emit = (event) => res.write(JSON.stringify(event) + '\n');
        try {
          const caller = await enter(side, body);
          const plugins = await loadPlugins(side, modules);
          const data = body.data || {};
          const scope = chatScope ? await chatScope(caller, data) : null;
          await answer(caller, side, data, emit, env, plugins, scope);
        } catch (err) {
          if (!err.code) await log(side + ' chat:send', err);
          emit({ type: 'error', error: err.code || 'SERVER_ERROR' });
        }
        res.end();
        return;
      }

      // ---------- Everything else ----------
      try {
        const plugins = await loadPlugins(side, modules);
        const table = { ...chatRoutes(side), ...actionsOf(plugins, side) };
        // Admin changes are recorded (core/audit.js), from buttons and chat alike
        const own = side === 'admin' ? audited(table) : table;
        // Actions the chat proposed run through this same table on Confirm
        const routes = { ...own, ...actionRoutes(side, own) };
        const route = routes[body.action];
        if (!route) throw new ApiError('UNKNOWN_ACTION');
        const run = typeof route === 'function' ? route : route.run;

        if (route.public) {
          res.json({ ok: true, data: await run(null, body.data || {}, env, body) });
          return;
        }
        if (req.method === 'GET') throw new ApiError('UNKNOWN_ACTION');
        const caller = await enter(side, body);
        // Visitors without a login only reach actions marked { guest: true }
        if (!caller.signedIn && !route.guest) throw new ApiError('AUTH_REQUIRED');
        res.json({ ok: true, data: await run(caller, body.data || {}, env, body) });
      } catch (err) {
        if (!err.code) await log(side + ' ' + body.action, err);
        res.json({ ok: false, error: err.code || 'SERVER_ERROR' });
      }
    },
  );
}

// The guard at the door: a login (or a guest id on the client side) that
// belongs on this side
async function enter(side, body) {
  const caller = await identify(body.idToken, side === 'client' ? body.guestId : undefined);
  if (!allowed(caller, side)) throw new ApiError('FORBIDDEN');
  return caller;
}

// Visitors keep their conversations too, by their browser's guest id
function chatRoutes(side) {
  return {
    'chat:list': { guest: true, run: (caller) => listConversations(caller, side) },
    'chat:get': { guest: true, run: (caller, data) => getConversation(caller, side, data) },
    'chat:rename': { guest: true, run: (caller, data) => renameConversation(caller, side, data) },
    'chat:delete': { guest: true, run: (caller, data) => deleteConversation(caller, side, data) },
  };
}

// The site the request came from, for links in emails (e.g. a password link)
function siteOrigin(req) {
  const origin = String(req.headers.origin || '');
  return /^https:\/\/(www\.)?ailaw\.llc$/.test(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin)
    ? origin
    : 'https://www.ailaw.llc';
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}
