// ==========================================================
// Core: the chat
//   - conversations: list, open, rename, delete (Chat/{id} + Messages)
//   - answer: one question → streamed answer, with the tools the door's
//     plugins allow (up to MAX_TOOL_ROUNDS rounds of tool calls)
// A conversation belongs to one person and one side, so a lawyer's case
// chats and their own client chats never mix.
// A scope ties a conversation to one piece of work (e.g. a lawyer's
// assignment): one thread per person and scope, with that work's context
// in the instructions and only that work's service. The door supplies it.
//   scope = { key, prompt, pluginIds }
// Without a scope, the client chat opens one service at a time
// (openService): the conversation remembers it as activeService, and its
// plugin's know-how and tools come along from then on.
// ==========================================================

import { ApiError, db, now, parseJson, today, toDate } from './app.js';
import { streamTurn } from './ai.js';
import { countQuestion } from './guard.js';
import { buildPrompt, toolsOf } from './loader.js';
import { chatSettings, serviceBySlug } from './records.js';

const TITLE_LENGTH = 40;
const MAX_QUESTION_LENGTH = 4000;
const MAX_TOOL_ROUNDS = 5;

const ms = (value) => toDate(value)?.getTime() || 0;

// ---------- Conversations ----------

export async function listConversations(caller, side) {
  const snap = await db.collection('Chat').where('ownerId', '==', caller.ownerId).get();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((c) => !c.deleted && !c.scope && (c.side || 'client') === side)
    .sort((a, b) => ms(b.updatedAt) - ms(a.updatedAt))
    .map((c) => ({ id: c.id, title: String(c.title), updatedAt: ms(c.updatedAt) }));
}

export async function getConversation(caller, side, data) {
  const conversation = await ownConversation(caller, side, data.conversationId);
  const messages = await conversationMessages(conversation.id);
  return {
    id: conversation.id,
    title: String(conversation.title),
    updatedAt: ms(conversation.updatedAt),
    messages: messages.map(toClientMessage),
  };
}

export async function renameConversation(caller, side, data) {
  const conversation = await ownConversation(caller, side, data.conversationId);
  const title = String(data.title || '').trim().slice(0, 80);
  if (!title) throw new ApiError('INVALID_INPUT');
  await db.doc('Chat/' + conversation.id).update({ title });
  return { id: conversation.id, title };
}

export async function deleteConversation(caller, side, data) {
  const conversation = await ownConversation(caller, side, data.conversationId);
  await db.doc('Chat/' + conversation.id).update({ deleted: true });
  return { id: conversation.id };
}

async function ownConversation(caller, side, conversationId) {
  if (!conversationId || !/^[A-Za-z0-9_-]{1,64}$/.test(conversationId)) throw new ApiError('NOT_FOUND');
  const snap = await db.doc('Chat/' + conversationId).get();
  const c = snap.exists ? { id: snap.id, ...snap.data() } : null;
  if (!c || c.deleted || c.ownerId !== caller.ownerId || (c.side || 'client') !== side) {
    throw new ApiError('NOT_FOUND');
  }
  return c;
}

async function conversationMessages(conversationId) {
  const snap = await db.collection(`Chat/${conversationId}/Messages`).orderBy('createdAt').get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((m) => !m.deleted);
}

function toClientMessage(m) {
  const parts = m.parts || [];
  const text = String(m.text || '');
  return {
    id: m.id,
    role: m.role,
    parts: text ? [{ type: 'text', text }, ...parts] : parts,
    createdAt: ms(m.createdAt),
  };
}

// The thread of one scope (an assignment), or an empty one
export async function scopedConversation(caller, side, key) {
  const snap = await db.collection('Chat').where('ownerId', '==', caller.ownerId).where('scope', '==', key).get();
  const c = snap.docs.map((d) => ({ id: d.id, ...d.data() })).find((x) => !x.deleted && x.side === side);
  if (!c) return { id: '', title: '', updatedAt: 0, messages: [] };
  const messages = await conversationMessages(c.id);
  return { id: c.id, title: String(c.title), updatedAt: ms(c.updatedAt), messages: messages.map(toClientMessage) };
}

// ---------- Answer ----------

// emit({ type, ... }) sends one event to the page:
// start → text… / part… → done (or error)
export async function answer(caller, side, data, emit, env, plugins, scope = null) {
  const question = String(data.text || '').trim().slice(0, MAX_QUESTION_LENGTH);
  if (!question) throw new ApiError('INVALID_INPUT');

  const settings = await chatSettings();
  await countQuestion(caller, settings);

  // A scoped thread is found by its scope
  if (scope) {
    const thread = await scopedConversation(caller, side, scope.key);
    if (thread.id) data = { ...data, conversationId: thread.id };
  }

  let conversation;
  let earlier = [];
  if (data.conversationId) {
    conversation = await ownConversation(caller, side, data.conversationId);
    earlier = await conversationMessages(conversation.id);
  } else {
    conversation = {
      id: db.collection('Chat').doc().id,
      ownerId: caller.ownerId,
      email: caller.email || '',
      side,
      ...(scope ? { scope: scope.key } : {}),
      title: question.length > TITLE_LENGTH ? question.slice(0, TITLE_LENGTH).trim() + '…' : question,
      deleted: false,
      createdAt: now(),
      updatedAt: now(),
      isNew: true,
    };
  }
  const chatRef = db.doc('Chat/' + conversation.id);

  // Editing an earlier question drops it and everything after it
  if (data.replaceFromMessageId) {
    const from = earlier.findIndex((m) => m.id === data.replaceFromMessageId);
    if (from >= 0) {
      const batch = db.batch();
      earlier.slice(from).forEach((m) => batch.update(chatRef.collection('Messages').doc(m.id), { deleted: true }));
      await batch.commit();
      earlier = earlier.slice(0, from);
    }
  }

  const userMessage = { id: chatRef.collection('Messages').doc().id, role: 'user', text: question, parts: [], deleted: false, createdAt: now() };
  emit({ type: 'start', conversationId: conversation.id, title: String(conversation.title), userMessage: toClientMessage(userMessage) });

  const history = earlier
    .slice(-Number(settings.HistoryMessages || 20))
    .map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: String(m.text || '') }))
    .filter((m) => m.content)
    .concat({ role: 'user', content: question });

  const ctx = {
    caller,
    side,
    conversationId: conversation.id,
    parts: [],
    settings,
    env,
    emit,
    plugins,
    scope,
    activeService: conversation.activeService || '',
    services: [],
  };
  await settleServices(ctx);
  const text = await runAssistant(ctx, history);

  // Saved after the answer, so a failed first question leaves no empty chat behind
  if (conversation.isNew) {
    const { id, isNew, ...record } = conversation;
    await chatRef.set({ ...record, activeService: ctx.activeService });
  } else {
    await chatRef.update({ updatedAt: now(), activeService: ctx.activeService });
  }
  const { id: userId, ...userRecord } = userMessage;
  await chatRef.collection('Messages').doc(userId).set(userRecord);
  const reply = { role: 'assistant', text, parts: ctx.parts, deleted: false, createdAt: now() };
  const replyRef = await chatRef.collection('Messages').add(reply);

  emit({ type: 'done', reply: toClientMessage({ id: replyRef.id, ...reply }) });
}

// The service plugins in play: the scope's, or the client's open service
export async function settleServices(ctx) {
  if (ctx.scope) {
    ctx.services = ctx.scope.pluginIds || [];
    return;
  }
  const service = ctx.activeService ? await serviceBySlug(ctx.activeService) : null;
  ctx.services = service?.plugin ? [service.plugin] : [];
}

// Opens a service in this conversation: its know-how and tools are loaded
// for the rest of the turn and for every later message
export async function openService(ctx, slug) {
  ctx.activeService = slug;
  await settleServices(ctx);
  if (ctx.plugins) ctx.tools = toolsOf(ctx.plugins, ctx);
}

// Cards go into the saved message and straight to the page
export function addPart(ctx, part) {
  ctx.parts.push(part);
  ctx.emit({ type: 'part', part });
}

async function runAssistant(ctx, history) {
  ctx.tools = toolsOf(ctx.plugins, ctx);
  const prompt = (await buildPrompt(ctx.plugins, ctx)) + (ctx.scope?.prompt ? '\n\n' + ctx.scope.prompt : '');
  const who = ctx.caller.signedIn
    ? `The person is signed in${ctx.caller.name ? ' as ' + ctx.caller.name : ''}.`
    : 'The person is not signed in.';
  const messages = [
    { role: 'system', content: `${prompt}\n\n## Context\nToday is ${today()} (Tbilisi). ${who}` },
    ...history,
  ];
  // The tool list is rebuilt each round: opening a service adds its tools
  const toolList = () =>
    Object.entries(ctx.tools).map(([name, tool]) => ({
      type: 'function',
      function: tool.parameters
        ? { name, description: tool.description, parameters: tool.parameters }
        : { name, description: tool.description },
    }));

  // Text from every round is kept: models often write part of the answer in
  // the same turn as a tool call
  let written = '';
  const write = (text) => {
    written += text;
    ctx.emit({ type: 'text', text });
  };

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let first = true;
    const { content, toolCalls } = await streamTurn({
      messages,
      tools: toolList(),
      settings: ctx.settings,
      keys: ctx.env.keys,
      onText: (text) => {
        if (first && written && !written.endsWith('\n\n')) write('\n\n');
        first = false;
        write(text);
      },
    });
    if (!toolCalls.length) return written.trim();

    messages.push({ role: 'assistant', content: content || null, tool_calls: toolCalls });
    for (const call of toolCalls) {
      let result;
      try {
        const tool = ctx.tools[call.function.name];
        if (!tool) throw new ApiError('UNKNOWN_TOOL');
        result = await tool.run(ctx, parseJson(call.function.arguments, {}));
      } catch (err) {
        result = { error: err.code || 'TOOL_FAILED' };
        if (!err.code) console.error(err);
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  return written.trim() || 'Sorry, I could not finish that. Please try again.';
}
