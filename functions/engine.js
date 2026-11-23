// ==========================================================
// The chat engine
//   - conversations and messages
//   - the AI loop with its tools (TOOLS)
//   - service orders and their steps, run by CAPABILITIES
//   - the lawyer's Review queue
// Knowledge (settings, instructions, services, steps) lives in the Chat
// spreadsheet, so most changes are sheet edits, not code.
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
  const users = await cached('users', 60, () => readTab(USERS_SHEET_ID, 'Users'));
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
      return (
        `- id: ${s.ServiceId} — ${s.Title}, ${s.Price} ${s.Currency}\n  ${s.Summary}\n` +
        `  Offer when: ${s.WhenToOffer}` +
        (list ? `\n  Details needed to order:\n${list}` : '')
      );
    })
    .join('\n');

  const caller = ctx.caller;
  const who = caller.signedIn
    ? `The client is signed in${caller.name ? ' as ' + caller.name : ''} and can order.`
    : 'The client is not signed in: they can ask questions, but must sign in (Log in, top right) before ordering.';

  return (
    `${instructions}\n\n## Services list\n${services || '(no services yet)'}` +
    `\n\n## Context\nToday is ${today()} (Tbilisi). ${who}`
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
      const orders = await listMyOrders(ctx.caller);
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

  const stamp = today().slice(2).replace(/-/g, ''); // yyMMdd
  const order = {
    OrderId: `SO-${stamp}-${randomUUID().slice(0, 4).toUpperCase()}`,
    ServiceId: service.ServiceId,
    ServiceTitle: service.Title,
    UserId: ctx.caller.uid,
    Email: ctx.caller.email,
    Name: ctx.caller.name,
    ConversationId: ctx.conversationId,
    Price: Number(service.Price),
    Currency: service.Currency,
    Data: JSON.stringify(data),
    Status: 'in_progress',
    CreatedAt: Date.now(),
    UpdatedAt: Date.now(),
  };
  await append('ServiceOrders', order);

  // The order gets its own copy of the steps, so later edits to the
  // service don't change orders already running
  const own = steps
    .filter((s) => s.ServiceId === serviceId)
    .sort((a, b) => Number(a.StepNo) - Number(b.StepNo));
  for (const s of own) {
    await append('OrderSteps', {
      OrderId: order.OrderId,
      StepNo: Number(s.StepNo),
      StepId: s.StepId,
      Owner: s.Owner,
      Capability: s.Capability,
      ClientLabel: s.ClientLabel,
      LawyerTask: s.LawyerTask,
      Config: s.Config,
      Status: 'waiting',
      Result: '',
      Note: '',
      UpdatedAt: Date.now(),
    });
  }

  await advanceOrder(order.OrderId, ctx.env);
  return findOrder(order.OrderId);
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

async function findOrder(orderId) {
  const order = (await chatTab('ServiceOrders')).rows.find((o) => o.OrderId === orderId);
  if (!order) throw new ApiError('NOT_FOUND');
  return order;
}

async function orderSteps(orderId) {
  return (await chatTab('OrderSteps')).rows
    .filter((s) => s.OrderId === orderId)
    .sort((a, b) => Number(a.StepNo) - Number(b.StepNo));
}

// What the client may see: labels and statuses, never who does a step
function toClientOrder(order, steps) {
  const done = order.Status === 'completed';
  return {
    orderId: order.OrderId,
    title: order.ServiceTitle,
    status: order.Status,
    price: Number(order.Price),
    currency: order.Currency,
    createdAt: Number(order.CreatedAt),
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

export async function listMyOrders(caller) {
  if (!caller.signedIn) return [];
  const [orders, steps] = await Promise.all([chatTab('ServiceOrders'), chatTab('OrderSteps')]);
  return orders.rows
    .filter((o) => o.UserId === caller.uid)
    .sort((a, b) => Number(b.CreatedAt) - Number(a.CreatedAt))
    .map((o) =>
      toClientOrder(
        o,
        steps.rows
          .filter((s) => s.OrderId === o.OrderId)
          .sort((a, b) => Number(a.StepNo) - Number(b.StepNo)),
      ),
    );
}

// ==========================================================
// The step engine
// Runs chat steps one after another until it reaches a lawyer step
// (which waits in the admin Review page) or the end of the order.
// ==========================================================

async function advanceOrder(orderId, env) {
  const order = await findOrder(orderId);
  const steps = await orderSteps(orderId);

  for (const step of steps) {
    if (step.Status === 'done') continue;

    if (step.Owner === 'lawyer') {
      if (step.Status !== 'active') {
        await update('OrderSteps', step._row, { Status: 'active', UpdatedAt: Date.now() });
        await notifyLawyer(order, step, env);
      }
      return;
    }

    const capability = CAPABILITIES[step.Capability];
    if (!capability) throw new ApiError('UNKNOWN_CAPABILITY');

    const result = (await capability(order, step, steps, parseJson(step.Config, {}), env)) || '';
    await update('OrderSteps', step._row, {
      Status: 'done',
      Result: result,
      UpdatedAt: Date.now(),
    });
    step.Status = 'done';
    step.Result = result;
  }

  await update('ServiceOrders', order._row, { Status: 'completed', UpdatedAt: Date.now() });
}

// ==========================================================
// Capabilities: what a chat-owned step can do
// Each gets (order, step, allSteps, config, env) and returns a short result.
// ==========================================================

const CAPABILITIES = {
  // The details were collected in the conversation before the order existed
  collect: () => 'Details received',

  // config: { base, rate, output } — e.g. 1% of income stored as "tax"
  calculate: async (order, step, steps, config) => {
    const data = parseJson(order.Data, {});
    const value = Math.round(Number(data[config.base] || 0) * Number(config.rate) * 100) / 100;
    data[config.output] = value;
    order.Data = JSON.stringify(data);
    await update('ServiceOrders', order._row, { Data: order.Data, UpdatedAt: Date.now() });
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
  if (!to) return;
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

export async function adminTasks() {
  const [orders, steps] = await Promise.all([chatTab('ServiceOrders'), chatTab('OrderSteps')]);
  return steps.rows
    .filter((s) => s.Owner === 'lawyer' && s.Status === 'active')
    .map((s) => {
      const order = orders.rows.find((o) => o.OrderId === s.OrderId) || {};
      return {
        orderId: s.OrderId,
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
        createdAt: Number(order.CreatedAt),
        waitingSince: Number(s.UpdatedAt),
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

  await update('OrderSteps', step._row, {
    Status: 'done',
    Result: result,
    Note: String(data.note || '').trim() + (caller.email ? ' — ' + caller.email : ''),
    UpdatedAt: Date.now(),
  });
  await advanceOrder(data.orderId, env);
  return adminTasks();
}
