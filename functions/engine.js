// ==========================================================
// The chat engine
//   - conversations and messages
//   - the AI loop with its tools (TOOLS)
//   - service orders and their steps, run by CAPABILITIES
//   - the lawyer's Review queue
// Knowledge (settings, instructions, services, steps) lives in the Chat
// spreadsheet, so most changes are sheet edits, not code.
// Orders live in Orders Database like every other order: the chat places
// them through the Orders Apps Script (folder, agreement, email), and their
// steps are kept there in the OrderSteps tab.
// ==========================================================

import { randomUUID } from 'node:crypto';
import { ApiError, streamTurn } from './ai.js';
import {
  CHAT_SHEET_ID,
  USERS_SHEET_ID,
  appendRow,
  cached,
  readTab,
  readTabs,
  updateRow,
} from './sheets.js';

const TIME_ZONE = 'Asia/Tbilisi';

// Orders Database (the function's service account must be an Editor) and
// the Orders Apps Script, which places orders with the client's own token
const ORDERS_SHEET_ID = '1bpWDaAs71FNpQpIAg2INx3cMb7rMI15tNLMJ_BQkdOQ';
const ORDERS_API =
  'https://script.google.com/macros/s/AKfycbyaIvPqskHw6eW_9IM43PHQd0YV2Y0gZJM7x6ZC--KHWeZZJplDGEmQ51JUKYy7tD2H/exec';
// Who clients contact to get verified
const VERIFY_CONTACT = 'our lawyer Gocha Okreshidze (info@ailaw.llc, (+995) 591-893-893)';
const TITLE_LENGTH = 40;
const MAX_QUESTION_LENGTH = 4000;
const MAX_TOOL_ROUNDS = 5;

// Knowledge tabs: read together, kept for a minute so edits show up quickly
const KNOWLEDGE_TABS = ['Settings', 'Instructions', 'Services', 'ServiceFields', 'ServiceSteps'];
const KNOWLEDGE_SECONDS = 60;

// ---------- Small helpers ----------

const isTrue = (v) => v === true || String(v).toUpperCase() === 'TRUE';
const isUrl = (v) => /^https?:\/\/\S+$/.test(String(v || ''));
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TIME_ZONE }); // yyyy-mm-dd

function parseJson(text, fallback) {
  if (!text) return fallback;
  if (typeof text === 'object') return text;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

const chatTab = (tab) => readTab(CHAT_SHEET_ID, tab);
const append = (tab, obj) => appendRow(CHAT_SHEET_ID, tab, obj);
const update = (tab, row, changes) => updateRow(CHAT_SHEET_ID, tab, row, changes);
const ordersTab = (tab) => readTab(ORDERS_SHEET_ID, tab);
const appendOrders = (tab, obj) => appendRow(ORDERS_SHEET_ID, tab, obj);
const updateOrders = (tab, row, changes) => updateRow(ORDERS_SHEET_ID, tab, row, changes);
const nowIso = () => new Date().toISOString();

// Calls the Orders Apps Script; its error codes come back as ApiErrors
async function ordersApi(action, idToken, data) {
  const res = await fetch(ORDERS_API, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, idToken, data }),
  });
  let result;
  try {
    result = JSON.parse(await res.text());
  } catch {
    throw new ApiError('ORDERS_UNAVAILABLE');
  }
  if (!result.ok) throw new ApiError(result.error || 'ORDER_FAILED');
  return result.data;
}

export async function knowledge() {
  return cached('knowledge', KNOWLEDGE_SECONDS, async () => {
    const tabs = await readTabs(CHAT_SHEET_ID, KNOWLEDGE_TABS);
    const settings = {};
    tabs.Settings.rows.forEach((r) => {
      if (r.Key) settings[r.Key] = r.Value;
    });
    return {
      settings,
      instructions: tabs.Instructions.rows,
      services: tabs.Services.rows.filter((s) => isTrue(s.Active)),
      fields: tabs.ServiceFields.rows,
      steps: tabs.ServiceSteps.rows,
    };
  });
}

export async function findUser(uid) {
  const users = await cached('users', 60, () => readTab(USERS_SHEET_ID, 'Clients'));
  return users.rows.find((r) => r.UserID === uid) || null;
}

// ==========================================================
// Conversations
// ==========================================================

export async function listConversations(caller) {
  const table = await chatTab('Conversations');
  return table.rows
    .filter((c) => c.OwnerId === caller.ownerId && !isTrue(c.Deleted))
    .sort((a, b) => Number(b.UpdatedAt) - Number(a.UpdatedAt))
    .map((c) => ({ id: c.ConversationId, title: String(c.Title), updatedAt: Number(c.UpdatedAt) }));
}

export async function getConversation(caller, data) {
  const conversation = await ownConversation(caller, data.conversationId);
  const messages = await conversationMessages(conversation.ConversationId);
  return {
    id: conversation.ConversationId,
    title: String(conversation.Title),
    updatedAt: Number(conversation.UpdatedAt),
    messages: messages.map(toClientMessage),
  };
}

export async function renameConversation(caller, data) {
  const conversation = await ownConversation(caller, data.conversationId);
  const title = String(data.title || '')
    .trim()
    .slice(0, 80);
  if (!title) throw new ApiError('INVALID_INPUT');
  await update('Conversations', conversation._row, { Title: title });
  return { id: conversation.ConversationId, title };
}

export async function deleteConversation(caller, data) {
  const conversation = await ownConversation(caller, data.conversationId);
  await update('Conversations', conversation._row, { Deleted: true });
  return { id: conversation.ConversationId };
}

async function ownConversation(caller, conversationId) {
  const table = await chatTab('Conversations');
  const conversation = table.rows.find(
    (c) => c.ConversationId === conversationId && !isTrue(c.Deleted),
  );
  if (!conversation || conversation.OwnerId !== caller.ownerId) throw new ApiError('NOT_FOUND');
  return conversation;
}

async function conversationMessages(conversationId) {
  const table = await chatTab('Messages');
  return table.rows.filter((m) => m.ConversationId === conversationId && !isTrue(m.Deleted));
}

function toClientMessage(m) {
  const parts = parseJson(m.Parts, []);
  const text = String(m.Text || '');
  return {
    id: m.MessageId,
    role: m.Role,
    parts: text ? [{ type: 'text', text }, ...parts] : parts,
    createdAt: Number(m.CreatedAt),
  };
}

async function saveMessage(conversationId, role, text, parts) {
  const message = {
    MessageId: randomUUID(),
    ConversationId: conversationId,
    Role: role,
    Text: text,
    Parts: parts.length ? JSON.stringify(parts) : '',
    CreatedAt: Date.now(),
    Deleted: false,
  };
  await append('Messages', message);
  return message;
}

// ==========================================================
// Sending a message: the main loop, streamed to the page
// emit({ type, ... }) sends one event to the browser
// ==========================================================

export async function sendMessage(caller, data, emit, env) {
  const question = String(data.text || '')
    .trim()
    .slice(0, MAX_QUESTION_LENGTH);
  if (!question) throw new ApiError('INVALID_INPUT');

  const started = Date.now();

  // Everything needed before the AI starts, read at once: settings (cached),
  // today's usage, the conversation and its messages
  const [{ settings }, tabs] = await Promise.all([
    knowledge(),
    readTabs(CHAT_SHEET_ID, ['Usage', 'Conversations', 'Messages']),
  ]);
  const usageWrite = countQuestion(caller, settings, tabs.Usage);

  // Find the conversation, or prepare a new one (saved only once the answer exists)
  let conversation;
  let isNew = false;
  if (data.conversationId) {
    conversation = tabs.Conversations.rows.find(
      (c) => c.ConversationId === data.conversationId && !isTrue(c.Deleted),
    );
    if (!conversation || conversation.OwnerId !== caller.ownerId) throw new ApiError('NOT_FOUND');
  } else {
    isNew = true;
    conversation = {
      ConversationId: randomUUID(),
      OwnerId: caller.ownerId,
      Email: caller.email || '',
      Title:
        question.length > TITLE_LENGTH ? question.slice(0, TITLE_LENGTH).trim() + '…' : question,
      CreatedAt: Date.now(),
      UpdatedAt: Date.now(),
      Deleted: false,
    };
  }
  const conversationId = conversation.ConversationId;

  let earlier = isNew
    ? []
    : tabs.Messages.rows.filter((m) => m.ConversationId === conversationId && !isTrue(m.Deleted));

  // Editing an earlier question drops it and everything after it
  if (data.replaceFromMessageId) {
    const from = earlier.findIndex((m) => m.MessageId === data.replaceFromMessageId);
    if (from >= 0) {
      await Promise.all(
        earlier.slice(from).map((m) => update('Messages', m._row, { Deleted: true })),
      );
      earlier = earlier.slice(0, from);
    }
  }

  const userMessage = {
    MessageId: randomUUID(),
    ConversationId: conversationId,
    Role: 'user',
    Text: question,
    Parts: '',
    CreatedAt: Date.now(),
    Deleted: false,
  };

  emit({
    type: 'start',
    conversationId,
    title: String(conversation.Title),
    userMessage: toClientMessage(userMessage),
  });

  // Earlier messages for context, oldest first, then the new question
  const history = earlier
    .slice(-Number(settings.HistoryMessages || 20))
    .map((m) => ({ role: m.Role === 'user' ? 'user' : 'assistant', content: String(m.Text || '') }))
    .filter((m) => m.content)
    .concat({ role: 'user', content: question });

  console.log(`Ready for the AI after ${Date.now() - started} ms`);

  const ctx = { caller, conversationId, parts: [], settings, env, emit };
  const answer = await runAssistant(ctx, history);
  await usageWrite;

  // Saved after the answer, so a failed first question leaves no empty chat behind
  if (isNew) await append('Conversations', conversation);
  else await update('Conversations', conversation._row, { UpdatedAt: Date.now() });

  await append('Messages', userMessage);
  const reply = await saveMessage(conversationId, 'assistant', answer, ctx.parts);

  emit({ type: 'done', reply: toClientMessage(reply) });
}

// Daily question limit per person; admins are not counted.
// The check is immediate; the returned promise is the sheet update.
function countQuestion(caller, settings, table) {
  if (caller.isAdmin) return Promise.resolve();
  const limit = Number(
    caller.signedIn ? settings.UserQuestionsPerDay || 30 : settings.GuestQuestionsPerDay || 5,
  );
  const date = today();
  const usage = table.rows.find((u) => u.OwnerId === caller.ownerId && String(u.Date) === date);
  const count = usage ? Number(usage.Count) : 0;
  if (count >= limit) throw new ApiError(caller.signedIn ? 'LIMIT_REACHED' : 'GUEST_LIMIT_REACHED');

  return usage
    ? update('Usage', usage._row, { Count: count + 1 })
    : append('Usage', { OwnerId: caller.ownerId, Date: date, Count: 1 });
}

// ==========================================================
// The AI: instructions from the sheet, tools from TOOLS
// ==========================================================

async function runAssistant(ctx, history) {
  const messages = [{ role: 'system', content: await buildSystemPrompt(ctx) }, ...history];
  const tools = Object.entries(TOOLS).map(([name, tool]) => ({
    type: 'function',
    function: tool.parameters
      ? { name, description: tool.description, parameters: tool.parameters }
      : { name, description: tool.description },
  }));

  // Text from every round is kept: models often write part of the answer
  // in the same turn as a tool call
  let written = '';
  const write = (text) => {
    written += text;
    ctx.emit({ type: 'text', text });
  };

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    // A new round continues the answer on a new paragraph
    let first = true;
    let firstText = 0;
    const started = Date.now();
    const { content, toolCalls } = await streamTurn({
      messages,
      tools,
      settings: ctx.settings,
      keys: ctx.env.keys,
      onText: (text) => {
        if (!firstText) firstText = Date.now() - started;
        if (first && written && !written.endsWith('\n\n')) write('\n\n');
        first = false;
        write(text);
      },
    });
    console.log(
      `AI round ${round + 1}: first words after ${firstText || '-'} ms, done after ${Date.now() - started} ms, ` +
        (toolCalls.length
          ? 'tools: ' + toolCalls.map((c) => c.function.name).join(', ')
          : 'answer'),
    );

    if (!toolCalls.length) return written.trim();

    messages.push({ role: 'assistant', content: content || null, tool_calls: toolCalls });
    for (const call of toolCalls) {
      let result;
      try {
        const tool = TOOLS[call.function.name];
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

async function buildSystemPrompt(ctx) {
  const k = await knowledge();

  const instructions = k.instructions
    .filter((r) => isTrue(r.Active) && r.Text)
    .sort((a, b) => Number(a.Order) - Number(b.Order))
    .map((r) => `## ${r.Title}\n${r.Text}`)
    .join('\n\n');

  const services = k.services
    .map((s) => {
      const list = k.fields
        .filter((f) => f.ServiceId === s.ServiceId)
        .map(
          (f) =>
            `  - ${f.Field} (${f.Label}${f.Hint ? '; ' + f.Hint : ''})` +
            (isTrue(f.Required) ? '' : ' — optional'),
        )
        .join('\n');
      const forVerified = requiresOf(s) === 'verified' ? ' (verified clients only)' : '';
      return (
        `- id: ${s.ServiceId} — ${s.Title}, ${s.Price} ${s.Currency}${forVerified}\n  ${s.Summary}\n` +
        `  Offer when: ${s.WhenToOffer}` +
        (list ? `\n  Details needed to order:\n${list}` : '')
      );
    })
    .join('\n');

  const caller = ctx.caller;
  const who = caller.signedIn
    ? `The client is signed in${caller.name ? ' as ' + caller.name : ''} and can order.`
    : 'The client is not signed in: they can ask questions, but must sign in (Log in, top right) before ordering.';

  const verified = caller.signedIn && (await isVerified(caller.uid));
  const verification = verified
    ? 'The client is verified, so they can order every service.'
    : `The client is not verified: services marked "verified clients only" can't be ordered yet; ` +
      `for those, tell them to contact ${VERIFY_CONTACT} to get verified.`;

  return (
    `${instructions}\n\n## Services list\n${services || '(no services yet)'}` +
    `\n\n## Context\nToday is ${today()} (Tbilisi). ${who} ${verification}`
  );
}

// ==========================================================
// Tools the AI can call
// ==========================================================

const TOOLS = {
  offer_service: {
    description: 'Show the card of a service that fits the client, so they can see it and order.',
    parameters: {
      type: 'object',
      properties: { service_id: { type: 'string', description: 'id from the services list' } },
      required: ['service_id'],
    },
    run: async (ctx, args) => {
      const service = await findService(args.service_id);
      addPart(ctx, serviceCard(service));
      return { shown: true };
    },
  },

  start_order: {
    description:
      'Place an order for a service, after the client confirmed all details. ' +
      'Returns the order number, payment instructions and any calculated values (e.g. tax).',
    parameters: {
      type: 'object',
      properties: {
        service_id: { type: 'string' },
        details: {
          type: 'string',
          description:
            'The confirmed details as a JSON object keyed by field name, ' +
            'e.g. {"period":"2026-10","income":"1500"}',
        },
      },
      required: ['service_id', 'details'],
    },
    run: async (ctx, args) => {
      if (!ctx.caller.signedIn) return { error: 'SIGN_IN_REQUIRED' };
      // Requires = verified: we must know the client first
      const service = await findService(args.service_id);
      if (requiresOf(service) === 'verified' && !(await isVerified(ctx.caller.uid))) {
        return {
          error: 'VERIFICATION_REQUIRED',
          instruction: `This service is only for verified clients. Ask the client to contact ${VERIFY_CONTACT} to get verified; after that they can order it here.`,
        };
      }
      if (!ctx.caller.idToken) return { error: 'SIGN_IN_REQUIRED' };
      const order = await createOrder(ctx, args.service_id, parseJson(args.details, {}));
      addPart(ctx, await orderCard(order.OrderId));
      addPart(ctx, {
        type: 'payment',
        amount: Number(order.Price),
        currency: order.Currency,
        reference: order.OrderId,
      });
      return {
        orderId: order.OrderId,
        price: `${order.Price} ${order.Currency}`,
        details: parseJson(order.Data, {}),
        payment:
          'Shown to the client in a card under your answer (bank transfer, order number as reference).',
      };
    },
  },

  get_my_orders: {
    description: "The signed-in client's orders with the progress of each.",
    run: async (ctx) => {
      if (!ctx.caller.signedIn) return { error: 'SIGN_IN_REQUIRED' };
      const orders = await listMyOrders(ctx.caller, ctx.env);
      for (const o of orders.filter((o) => o.status !== 'completed').slice(0, 3)) {
        addPart(ctx, await orderCard(o.orderId));
      }
      return orders.slice(0, 10).map((o) => ({
        orderId: o.orderId,
        service: o.title,
        status: o.status,
        steps: o.steps.map((s) => `${s.label}: ${s.status}`).join('; '),
      }));
    },
  },
};

// Cards go into the saved message and straight to the page
function addPart(ctx, part) {
  ctx.parts.push(part);
  ctx.emit({ type: 'part', part });
}

// ==========================================================
// Services and orders
// ==========================================================

// Services tab → Requires: guest, user or verified; empty = user
function requiresOf(service) {
  return (
    String(service.Requires || '')
      .trim()
      .toLowerCase() || 'user'
  );
}

// Clients tab → Type = verified
async function isVerified(uid) {
  const user = uid ? await findUser(uid) : null;
  return !!user && String(user.Type || '').toLowerCase() === 'verified';
}

async function findService(serviceId) {
  const service = (await knowledge()).services.find((s) => s.ServiceId === serviceId);
  if (!service) throw new ApiError('SERVICE_NOT_FOUND');
  return service;
}

function serviceCard(service) {
  return {
    type: 'service',
    id: service.ServiceId,
    title: service.Title,
    summary: service.Summary,
    price: `${service.Price} ${service.Currency}`,
    link: service.Link || '/services',
  };
}

async function createOrder(ctx, serviceId, details) {
  const service = await findService(serviceId);
  const { fields, steps } = await knowledge();
  const data = validateDetails(
    fields.filter((f) => f.ServiceId === serviceId),
    details,
  );

  // A normal order in Orders Database; the service's ServiceId is its
  // Slug in Products Database
  const placed = await ordersApi('placeChatOrder', ctx.caller.idToken, {
    slug: service.ServiceId,
    details: data,
    conversationId: ctx.conversationId,
  });

  // The order gets its own copy of the steps, so later edits to the
  // service don't change orders already running
  const own = steps
    .filter((s) => s.ServiceId === serviceId)
    .sort((a, b) => Number(a.StepNo) - Number(b.StepNo));
  for (const s of own) {
    await appendOrders('OrderSteps', {
      OrderID: placed.orderId,
      OrderNumber: placed.orderNumber,
      StepNo: Number(s.StepNo),
      StepID: s.StepId,
      Owner: s.Owner,
      Capability: s.Capability,
      ClientLabel: s.ClientLabel,
      LawyerTask: s.LawyerTask,
      Config: s.Config,
      Status: 'waiting',
      Result: '',
      Note: '',
      UpdatedAt: nowIso(),
    });
  }

  await advanceOrder(placed.orderNumber, ctx.env);
  return findOrder(placed.orderNumber);
}

// Checks the AI's details against ServiceFields
function validateDetails(fields, details) {
  const data = {};
  for (const f of fields) {
    const raw = details[f.Field];
    const empty = raw === undefined || raw === null || String(raw).trim() === '';
    if (empty) {
      if (isTrue(f.Required)) throw new ApiError('MISSING_' + String(f.Field).toUpperCase());
      continue;
    }

    let value = String(raw).trim();
    if (f.Type === 'number') {
      value = Number(value.replace(',', '.').replace(/\s/g, ''));
      if (!Number.isFinite(value) || value < 0) {
        throw new ApiError('INVALID_' + String(f.Field).toUpperCase());
      }
    } else if (f.Type === 'month' && !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
      throw new ApiError('INVALID_' + String(f.Field).toUpperCase());
    }
    data[f.Field] = value;
  }
  return data;
}

// An Orders row in the shape the engine uses; OrderId is the order number
// (AIL-…), which clients see and use as the payment reference
function fromOrdersRow(r) {
  return {
    _row: r._row,
    OrderId: r.OrderNumber,
    OrderUuid: r.OrderID,
    ServiceTitle: r.Service,
    UserId: r.UserID,
    Email: r.CustomerEmail,
    Name: r.CustomerName,
    ConversationId: r.ConversationID,
    Price: r.Total,
    Currency: r.Currency,
    Data: r.Details || '{}',
    Status: r.OrderStatus,
    PaymentStatus: r.PaymentStatus,
    CreatedAt: r.CreatedAt,
    Source: r.Source,
  };
}

async function findOrder(orderNumber) {
  const row = (await ordersTab('Orders')).rows.find((o) => o.OrderNumber === orderNumber);
  if (!row) throw new ApiError('NOT_FOUND');
  return fromOrdersRow(row);
}

async function orderSteps(orderNumber) {
  return (await ordersTab('OrderSteps')).rows
    .filter((s) => s.OrderNumber === orderNumber)
    .sort((a, b) => Number(a.StepNo) - Number(b.StepNo));
}

// What the client may see: labels and statuses, never who does a step
function toClientOrder(order, steps) {
  const done = order.Status === 'completed';
  return {
    orderId: order.OrderId,
    title: order.ServiceTitle,
    // placed and in_progress both show as in progress
    status: done || order.Status === 'cancelled' ? order.Status : 'in_progress',
    price: Number(order.Price),
    currency: order.Currency,
    createdAt: new Date(order.CreatedAt).getTime() || Number(order.CreatedAt) || 0,
    details: parseJson(order.Data, {}),
    steps: steps.map((s) => ({
      label: s.ClientLabel,
      status: s.Status === 'active' ? 'in_progress' : s.Status,
    })),
    files: done ? steps.map((s) => s.Result).filter(isUrl) : [],
  };
}

async function orderCard(orderId) {
  const order = toClientOrder(await findOrder(orderId), await orderSteps(orderId));
  return {
    type: 'order',
    orderId: order.orderId,
    title: order.title,
    status: order.status,
    steps: order.steps,
  };
}

// Orders with steps only (chat orders); checkout orders have their own page
export async function listMyOrders(caller, env) {
  if (!caller.signedIn) return [];
  await resumePaidOrders(env);
  const [orders, steps] = await Promise.all([ordersTab('Orders'), ordersTab('OrderSteps')]);
  return orders.rows
    .filter((o) => o.UserID === caller.uid)
    .map(fromOrdersRow)
    .map((o) => ({
      order: o,
      steps: steps.rows
        .filter((s) => s.OrderNumber === o.OrderId)
        .sort((a, b) => Number(a.StepNo) - Number(b.StepNo)),
    }))
    .filter((x) => x.steps.length)
    .map((x) => toClientOrder(x.order, x.steps))
    .sort((a, b) => b.createdAt - a.createdAt);
}

// ==========================================================
// The step engine
// Runs chat steps one after another until it reaches a lawyer step
// (which waits in the admin Review page) or the end of the order.
// ==========================================================

async function advanceOrder(orderNumber, env) {
  const order = await findOrder(orderNumber);
  const steps = await orderSteps(orderNumber);

  for (const step of steps) {
    if (step.Status === 'done') continue;

    if (step.Owner === 'lawyer') {
      if (step.Status !== 'active') {
        await updateOrders('OrderSteps', step._row, { Status: 'active', UpdatedAt: nowIso() });
        await notifyLawyer(order, step, env);
      }
      return;
    }

    const capability = CAPABILITIES[step.Capability];
    if (!capability) throw new ApiError('UNKNOWN_CAPABILITY');

    const result = (await capability(order, step, steps, parseJson(step.Config, {}), env)) || '';
    // A step that has to wait (e.g. for the payment) stays active and stops here
    if (result && typeof result === 'object' && result.wait) {
      if (step.Status !== 'active') {
        await updateOrders('OrderSteps', step._row, { Status: 'active', UpdatedAt: nowIso() });
      }
      return;
    }
    await updateOrders('OrderSteps', step._row, {
      Status: 'done',
      Result: result,
      UpdatedAt: nowIso(),
    });
    step.Status = 'done';
    step.Result = result;
  }

  await updateOrders('Orders', order._row, {
    OrderStatus: 'completed',
    CompletedAt: nowIso(),
    UpdatedAt: nowIso(),
  });
}

// Orders waiting for their payment go on once the order is marked paid
// (admin page or Orders sheet). Checked when orders or tasks are opened.
async function resumePaidOrders(env) {
  const [orders, steps] = await Promise.all([ordersTab('Orders'), ordersTab('OrderSteps')]);
  const waiting = steps.rows.filter(
    (s) => s.Capability === 'await_payment' && s.Status === 'active',
  );
  for (const step of waiting) {
    const order = orders.rows.find((o) => o.OrderNumber === step.OrderNumber);
    if (order && order.PaymentStatus === 'paid') {
      try {
        await advanceOrder(step.OrderNumber, env);
      } catch (err) {
        console.error('Resume order ' + step.OrderNumber, err);
      }
    }
  }
}

// ==========================================================
// Capabilities: what a chat-owned step can do
// Each gets (order, step, allSteps, config, env) and returns a short result.
// ==========================================================

const CAPABILITIES = {
  // The details were collected in the conversation before the order existed
  collect: () => 'Details received',

  // Waits until the order is marked paid in Orders Database
  await_payment: (order) => (order.PaymentStatus === 'paid' ? 'Paid' : { wait: true }),

  // config: { base, rate, output } — e.g. 1% of income stored as "tax"
  calculate: async (order, step, steps, config) => {
    const data = parseJson(order.Data, {});
    const value = Math.round(Number(data[config.base] || 0) * Number(config.rate) * 100) / 100;
    data[config.output] = value;
    order.Data = JSON.stringify(data);
    await updateOrders('Orders', order._row, { Details: order.Data, UpdatedAt: nowIso() });
    return `${config.output} = ${value}`;
  },

  // Sends every link produced by earlier steps to the client: in the chat
  // where they ordered, and by email if config.email is set
  deliver: async (order, step, steps, config, env) => {
    const links = steps.filter((s) => s.Status === 'done' && isUrl(s.Result)).map((s) => s.Result);
    const text =
      `Your order **${order.OrderId}** (${order.ServiceTitle}) is complete.` +
      (links.length ? '\n\n' + links.map((l, i) => `[Document ${i + 1}](${l})`).join('\n') : '');

    if (order.ConversationId) {
      await saveMessage(order.ConversationId, 'assistant', text, []);
      const row = (await chatTab('Conversations')).rows.find(
        (c) => c.ConversationId === order.ConversationId,
      );
      if (row) await update('Conversations', row._row, { UpdatedAt: Date.now() });
    }

    if (config.email && order.Email) {
      await env.sendMail({
        to: order.Email,
        subject: `AI Law — ${order.ServiceTitle} (${order.OrderId})`,
        body:
          text.replace(/\*\*/g, '').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1: $2') +
          '\n\nAI Law LLC · ailaw.llc',
      });
    }
    return 'Delivered';
  },
};

async function notifyLawyer(order, step, env) {
  const to = (await knowledge()).settings.LawyerEmail;
  if (!to || !env) return;
  await env.sendMail({
    to,
    subject: `AI Law task: ${step.ClientLabel} — ${order.OrderId}`,
    body: [
      `${order.ServiceTitle} — ${order.OrderId}`,
      `Client: ${order.Name || ''} <${order.Email}>`,
      `Details: ${order.Data}`,
      '',
      `Task: ${step.LawyerTask}`,
      '',
      'Open ailaw.llc/admin/review to mark it done.',
    ].join('\n'),
  });
}

// ==========================================================
// Lawyer: the Review page
// ==========================================================

export async function adminTasks(caller, env) {
  await resumePaidOrders(env);
  const [orders, steps] = await Promise.all([ordersTab('Orders'), ordersTab('OrderSteps')]);
  return steps.rows
    .filter((s) => s.Owner === 'lawyer' && s.Status === 'active')
    .map((s) => {
      const row = orders.rows.find((o) => o.OrderNumber === s.OrderNumber);
      const order = row ? fromOrdersRow(row) : {};
      return {
        orderId: s.OrderNumber,
        stepNo: Number(s.StepNo),
        label: s.ClientLabel,
        task: s.LawyerTask,
        needsFile: !!parseJson(s.Config, {}).needsFile,
        service: order.ServiceTitle,
        clientName: order.Name,
        clientEmail: order.Email,
        price: Number(order.Price),
        currency: order.Currency,
        details: parseJson(order.Data, {}),
        createdAt: new Date(order.CreatedAt).getTime() || 0,
        waitingSince: new Date(s.UpdatedAt).getTime() || Number(s.UpdatedAt) || 0,
      };
    })
    .sort((a, b) => a.waitingSince - b.waitingSince);
}

export async function adminCompleteStep(caller, data, env) {
  const step = (await orderSteps(data.orderId)).find(
    (s) => Number(s.StepNo) === Number(data.stepNo),
  );
  if (!step || step.Owner !== 'lawyer' || step.Status !== 'active') throw new ApiError('NOT_FOUND');

  const result = String(data.result || '').trim();
  if (parseJson(step.Config, {}).needsFile && !isUrl(result)) {
    throw new ApiError('FILE_LINK_REQUIRED');
  }

  await updateOrders('OrderSteps', step._row, {
    Status: 'done',
    Result: result,
    Note: String(data.note || '').trim() + (caller.email ? ' — ' + caller.email : ''),
    UpdatedAt: nowIso(),
  });
  await advanceOrder(data.orderId, env);
  return adminTasks(caller, env);
}
