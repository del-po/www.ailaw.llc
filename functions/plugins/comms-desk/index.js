// ==========================================================
// Plugin: communications desk (admin)
// The Admin Panel's Communications: every conversation on the platform
// (clients, visitors, lawyers, admins), to read, to answer in person and to
// mark for a person's attention.
//   comms:list       conversations, latest first: by assistant (side), words
//                    in the title or email, period, and needing a person
//   comms:get        one conversation in full, with who it belongs to
//   comms:reply      a message from the AI Law team into the conversation
//                    (the client sees it in their chat), and by email if asked
//   comms:attention  marks a conversation as needing a person, or settles it
// A failed or unfinished answer marks its conversation by itself (core/chat.js).
// Answers can be marked as AI mistakes from here (ai:flag, plugins/ai-desk).
// ==========================================================

import { ApiError, cleanKey, cleanText, db, iso, now, validEmail } from '../../core/app.js';
import { proposeAction } from '../../core/chat-actions.js';
import { clientByUid, docs } from '../../core/records.js';
import { mail } from '../../core/steps.js';

const DAY_TEXT = /^\d{4}-\d{2}-\d{2}$/;
const SIGNATURE = '**AI Law team:** ';

const summary = (c) => ({
  id: c.id,
  side: c.side || 'client',
  title: String(c.title || ''),
  email: c.email || '',
  guest: String(c.ownerId || '').startsWith('guest:'),
  scope: c.scope || '',
  activeService: c.activeService || '',
  updatedAt: iso(c.updatedAt),
  createdAt: iso(c.createdAt),
  needsHuman: c.needsHuman === true,
  needsHumanReason: c.needsHumanReason || '',
  answeredByTeamAt: iso(c.answeredByTeamAt),
});

async function list(data) {
  let query = db.collection('Chat').orderBy('updatedAt', 'desc');
  if (DAY_TEXT.test(data.from || '')) query = query.where('updatedAt', '>=', new Date(data.from + 'T00:00:00+04:00'));
  if (DAY_TEXT.test(data.to || '')) query = query.where('updatedAt', '<=', new Date(data.to + 'T23:59:59.999+04:00'));
  const words = String(data.query || '').toLowerCase().split(/\s+/).filter(Boolean);
  return docs(await query.limit(500).get())
    .filter((c) => !c.deleted)
    .map(summary)
    .filter((c) => !data.side || c.side === data.side)
    .filter((c) => !data.attention || c.needsHuman)
    .filter((c) => words.every((w) => [c.title, c.email, c.id, c.activeService].join(' ').toLowerCase().includes(w)));
}

async function requireChat(conversationId) {
  const id = cleanKey(conversationId, 'NOT_FOUND');
  const snap = await db.doc('Chat/' + id).get();
  if (!snap.exists) throw new ApiError('NOT_FOUND');
  return { id, ref: snap.ref, ...snap.data() };
}

async function get(data) {
  const chat = await requireChat(data.conversationId);
  const messages = docs(await chat.ref.collection('Messages').orderBy('createdAt').get());
  const client = chat.ownerId && !String(chat.ownerId).startsWith('guest:') ? await clientByUid(chat.ownerId) : null;
  return {
    ...summary(chat),
    owner: client
      ? { clientId: client.id, name: client.displayName || '', email: client.email || '', type: client.type }
      : null,
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      text: String(m.text || ''),
      // Cards the chat showed (orders, payments, confirmations …), by kind
      parts: (m.parts || []).map((p) => p.type),
      team: m.team === true,
      deleted: m.deleted === true,
      mistakeId: m.mistakeId || '',
      createdAt: iso(m.createdAt),
    })),
  };
}

// The AI Law team's own answer: in the conversation, and by email when asked
async function reply(caller, data, env) {
  const chat = await requireChat(data.conversationId);
  const text = cleanText(data.text, 8000, 'INVALID_INPUT');
  if (!text) throw new ApiError('INVALID_INPUT');
  await chat.ref.collection('Messages').add({
    role: 'assistant',
    text: SIGNATURE + text,
    parts: [],
    team: true,
    by: caller.email || '',
    deleted: false,
    createdAt: now(),
  });
  await chat.ref.update({ updatedAt: now(), needsHuman: false, needsHumanReason: '', answeredByTeamAt: now() });

  let emailed = '';
  if (data.email === true) {
    const client = chat.ownerId && !String(chat.ownerId).startsWith('guest:') ? await clientByUid(chat.ownerId) : null;
    const to = client?.email || chat.email || '';
    if (!validEmail(to)) throw new ApiError('CLIENT_HAS_NO_EMAIL');
    const sent = await mail(env, {
      to,
      subject: `AI Law — about your question "${String(chat.title || '').slice(0, 60)}"`,
      text: [
        client?.firstName ? `Dear ${client.firstName},` : 'Hello,',
        '',
        text,
        '',
        'You can also read this in your chat on www.ailaw.llc.',
        '',
        'AI Law LLC · www.ailaw.llc',
      ].join('\n'),
    });
    if (!sent) throw new ApiError('EMAIL_FAILED');
    emailed = to;
  }
  return { ...(await get({ conversationId: chat.id })), emailed };
}

async function attention(data) {
  const chat = await requireChat(data.conversationId);
  const needsHuman = data.needsHuman === true;
  await chat.ref.update({
    needsHuman,
    needsHumanReason: needsHuman ? cleanText(data.note || 'marked by AI Law', 300) : '',
  });
  return get({ conversationId: chat.id });
}

// ---------- Admin chat tools ----------

const safe = (run) => async (ctx, args) => {
  try {
    return await run(ctx, args || {});
  } catch (err) {
    if (err instanceof ApiError) return { error: err.code };
    throw err;
  }
};

const tools = {
  conversations_find: {
    sides: ['admin'],
    description:
      'Conversations on the platform, latest first: by assistant (side: client, lawyer, admin), words in the title or ' +
      'email, period (from/to yyyy-MM-dd), or only those needing a person (attention).',
    parameters: {
      type: 'object',
      properties: {
        side: { type: 'string', enum: ['client', 'lawyer', 'admin'] },
        query: { type: 'string' },
        from: { type: 'string' },
        to: { type: 'string' },
        attention: { type: 'boolean' },
      },
    },
    run: safe(async (ctx, a) => (await list(a)).slice(0, 30)),
  },
  conversation_read: {
    sides: ['admin'],
    description: 'One conversation in full: its messages, and the client it belongs to.',
    parameters: { type: 'object', properties: { conversationId: { type: 'string' } }, required: ['conversationId'] },
    run: safe(async (ctx, a) => {
      const c = await get(a);
      return { ...c, messages: c.messages.filter((m) => !m.deleted).slice(-40).map((m) => ({ ...m, text: m.text.slice(0, 2000) })) };
    }),
  },
  conversation_reply: {
    sides: ['admin'],
    description:
      'Proposes a reply from the AI Law team into a conversation (the client sees it in their chat), and by email if ' +
      'email is true. Shows a Confirm card; nothing is sent until the admin confirms.',
    parameters: {
      type: 'object',
      properties: { conversationId: { type: 'string' }, text: { type: 'string' }, email: { type: 'boolean' } },
      required: ['conversationId', 'text'],
    },
    run: safe(async (ctx, a) => {
      const c = await requireChat(a.conversationId);
      return proposeAction(ctx, {
        action: 'comms:reply',
        data: { conversationId: c.id, text: String(a.text || ''), email: a.email === true },
        title: `Reply in "${String(c.title || '').slice(0, 50)}"`,
        lines: [String(a.text || '').slice(0, 300), a.email ? 'Also by email.' : 'In the chat only.'],
      });
    }),
  },
};

export default {
  id: 'comms-desk',
  sides: ['admin'],
  actions: {
    admin: {
      'comms:list': (caller, data) => list(data),
      'comms:get': (caller, data) => get(data),
      'comms:reply': (caller, data, env) => reply(caller, data, env),
      'comms:attention': (caller, data) => attention(data),
    },
  },
  tools,
};
