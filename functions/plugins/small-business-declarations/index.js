// ==========================================================
// Plugin: small business declarations (client + admin)
// The 1% declarations service as one tool:
//   1. income comes in from any channel: the Telegram bot (telegram.js),
//      the website chat (tools below), the website itself, or AI Law by hand
//   2. AI Law sees every client's months (admin:declarations:list)
//   3. AI Law files the declaration on rs.ge, uploads the PDF and it is
//      delivered: saved in the client's folder and sent (delivery.js)
// Data: data.js. Contract signing is not here: it belongs to checkout.
// Client (signed in, and linked to a declarations client):
//   declarations:my        the client's months, debt and declaration files
//   declarations:report    report last month's income (the profile form)
//   declarations:draft     a chat draft, to fill the form ("Edit")
//   declarations:confirm   the client presses Confirm on a chat draft
// The chat never saves income itself: it drafts, shows a card with every
// entry and the total, and only the client's Confirm saves it.
// Admin (a client is named by key: registration ID, or ID-… code):
//   declarations:list           the year's clients with their months
//   declarations:counts         for the admin sidebar: the reporting month's
//                               not reported / to file / to verify
//   declarations:setMonth       a month's income and/or tax, by hand (the
//                               tax is always typed in from rs.ge)
//   declarations:setDebt        outstanding debt, as shown on rs.ge
//   declarations:setContacts    registration ID, Telegram chat id, email
//   declarations:setStatus      active / ended (the client cancelled)
//   declarations:add            put a client on the list by hand
//   declarations:delete         take a client off the list completely
//                               (e.g. a test), optionally with their files
//   declarations:verify         a pending (self-registered) client → active
//   declarations:deliver        upload a declaration → folder → client
//   declarations:settings       sending test/live, fee, bank account …
// Ordering the service on the website puts the client on the list at once
// (onOrderPlaced below): no verification, no wait for payment.
// ==========================================================

import { ApiError, cleanKey, cleanText, now, validEmail } from '../../core/app.js';
import { addPart } from '../../core/chat.js';
import { proposeAction } from '../../core/chat-actions.js';
import { onOrderPlaced } from '../../core/orders.js';
import { clientByUid } from '../../core/records.js';
import {
  FOLDER,
  TOOL,
  allClients,
  checkMonth,
  addClient,
  clientRef,
  deleteClient,
  enrol,
  findClient,
  monthRef,
  months,
  reportIncome,
  reportingMonth,
  requireActive,
  round2,
  settings,
  verify,
} from './data.js';
import { deliver, methodOf, monthName } from './delivery.js';
import { CURRENCIES, gelRate } from './rates.js';
import { sendMessage } from './telegram-api.js';

export { handleUpdate } from './telegram.js';

// ---------- Shapes for the website ----------

const iso = (v) => (v?.toDate ? v.toDate() : v)?.toISOString?.() || '';

function toMonth(m) {
  return {
    month: m.month,
    income: m.income ?? null,
    tax: m.tax ?? null,
    serviceFee: m.serviceFee ?? null,
    source: m.source || '',
    reportedAt: iso(m.reportedAt),
    declarationFile: m.declarationFile || '',
    deliveredAt: iso(m.deliveredAt),
    deliveredVia: m.deliveredVia || '',
  };
}

function toClient(c, list = []) {
  return {
    key: c.id,
    registrationId: c.registrationId || '',
    name: c.name,
    clientId: c.clientId || '',
    status: c.status || 'active',
    telegramId: c.telegramId || '',
    telegramUsername: c.telegramUsername || '',
    email: c.email || '',
    deliveryMethod: methodOf(c),
    serviceStart: c.serviceStart || '',
    endedAt: iso(c.endedAt),
    duplicateOf: c.duplicateOf || '',
    outstandingDebt: round2(c.outstandingDebt),
    months: list.map(toMonth).sort((a, b) => a.month.localeCompare(b.month)),
  };
}

// ---------- Income from the website ----------

// entries: [{ date: 'yyyy-MM-dd', currency, amount }] → in GEL at the NBG rate
async function toGel(entries, month) {
  const out = [];
  for (const e of entries) {
    const date = String(e.date || '');
    if (!date.startsWith(month + '-') || Number.isNaN(Date.parse(date))) throw new ApiError('INVALID_DATE');
    const currency = String(e.currency || 'GEL').toUpperCase();
    if (!CURRENCIES.includes(currency)) throw new ApiError('INVALID_CURRENCY');
    const amount = Number(e.amount);
    if (!(amount >= 0)) throw new ApiError('INVALID_AMOUNT');
    const rate = await gelRate(currency, date);
    if (!rate) throw new ApiError('RATE_UNAVAILABLE');
    out.push({ date, currency, amount, rate, gel: round2(amount * rate) });
  }
  return out;
}

async function ownClient(caller) {
  const record = await clientByUid(caller.uid);
  return requireActive(record?.clientId ? await findClient({ clientId: record.clientId }) : null);
}

// The previous month's entries from the website, checked and in GEL
async function websiteEntries(data) {
  const month = reportingMonth();
  const entries = data.zero ? [] : await toGel(Array.isArray(data.entries) ? data.entries.slice(0, 50) : [], month);
  if (!data.zero && !entries.length) throw new ApiError('NO_INCOME_ENTRIES');
  return { month, entries };
}

async function reportFromSite(caller, data) {
  const client = await ownClient(caller);
  const { month, entries } = await websiteEntries(data);
  const note = cleanText(data.note ?? '', 2000);
  const saved = await reportIncome(client, { month, entries, source: 'website', by: caller.uid, note });
  return { month, income: saved.income, previousIncome: saved.previousIncome };
}

// ---------- Chat drafts ----------

const drafts = () => TOOL.collection('Drafts');

async function ownDraft(caller, draftId) {
  const snap = await drafts().doc(cleanKey(draftId)).get();
  const draft = snap.data();
  if (!draft || draft.uid !== caller.uid) throw new ApiError('DRAFT_NOT_FOUND');
  return { ref: snap.ref, ...draft };
}

// The card the chat shows: every entry, the total, Confirm / Edit
async function makeDraft(ctx, args) {
  const client = await ownClient(ctx.caller);
  const { month, entries } = await websiteEntries(args || {});
  const income = round2(entries.reduce((s, e) => s + e.gel, 0));
  const previous = (await monthRef(client.id, month).get()).data()?.income ?? null;
  const draft = {
    uid: ctx.caller.uid,
    key: client.id,
    month,
    entries,
    income,
    previousIncome: previous,
    note: String(ctx.question || '').slice(0, 2000),
    conversationId: ctx.conversationId || '',
    status: 'draft',
    createdAt: now(),
  };
  const ref = drafts().doc();
  await ref.set(draft);
  addPart(ctx, {
    type: 'declaration',
    draftId: ref.id,
    month,
    monthName: monthName(month),
    entries: entries.map(({ date, currency, amount, rate, gel }) => ({ date, currency, amount, rate, gel })),
    income: draft.income,
    previousIncome: previous,
  });
  return draft;
}

async function confirmDraft(caller, data) {
  const draft = await ownDraft(caller, data.draftId);
  if (draft.status !== 'draft') throw new ApiError('ALREADY_CONFIRMED');
  // A draft from last month's chat can't be saved into the wrong month
  if (draft.month !== reportingMonth()) throw new ApiError('DRAFT_EXPIRED');
  const client = await ownClient(caller);
  if (client.id !== draft.key) throw new ApiError('DRAFT_NOT_FOUND');
  const saved = await reportIncome(client, {
    month: draft.month,
    entries: draft.entries,
    source: 'chat',
    by: caller.uid,
    note: draft.note,
  });
  await draft.ref.update({ status: 'confirmed', confirmedAt: now() });
  return { month: saved.month, income: saved.income };
}

// What the profile page shows; the declaration files are given as paths
// inside the client's own folder, the way the Documents page opens them
async function myDeclarations(caller, data) {
  const client = await ownClient(caller);
  const year = /^\d{4}$/.test(String(data.year || '')) ? String(data.year) : undefined;
  const c = toClient(client, await months(client.id, year));
  const cfg = await settings();
  return {
    reportingMonth: reportingMonth(),
    name: c.name,
    registrationId: c.registrationId,
    outstandingDebt: c.outstandingDebt,
    feePerDeclaration: cfg.feePerDeclaration,
    months: c.months.map((m) => ({
      month: m.month,
      income: m.income,
      tax: m.tax,
      reportedAt: m.reportedAt,
      deliveredAt: m.deliveredAt,
      fileId: m.declarationFile ? `${FOLDER}/${m.declarationFile.split('/').pop()}` : '',
    })),
  };
}

// ---------- Admin ----------

// The year's clients: everyone with figures in that year, plus, for the
// current year, every active client (a new one has no figures yet). Ended
// clients come too, marked: the page keeps them under its Ended filter.
async function list(data) {
  const year = /^\d{4}$/.test(String(data.year || '')) ? String(data.year) : reportingMonth().slice(0, 4);
  const current = reportingMonth().slice(0, 4);
  const cfg = await settings();
  const rows = [];
  for (const c of await allClients()) {
    // The test client only shows while testing
    if (c.id === cfg.testRegistrationId && cfg.sending === 'live') continue;
    const list = await months(c.id, year);
    const started = !c.serviceStart || c.serviceStart.slice(0, 4) <= year;
    const listed = list.length || c.status === 'ended' || (year >= current && started);
    if (listed) rows.push(toClient(c, list));
  }
  return {
    year,
    reportingMonth: reportingMonth(),
    sending: cfg.sending,
    clients: rows.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

async function counts() {
  const month = reportingMonth();
  const cfg = await settings();
  const result = { reportingMonth: month, notReported: 0, toFile: 0, toVerify: 0 };
  for (const c of await allClients()) {
    if (c.status === 'ended') continue;
    if (c.id === cfg.testRegistrationId && cfg.sending === 'live') continue;
    if (c.status === 'pending') {
      result.toVerify++;
      continue;
    }
    const m = (await monthRef(c.id, month).get()).data();
    if (!m || m.income == null) result.notReported++;
    else if (!m.deliveredAt && !m.declarationFile) result.toFile++;
  }
  return result;
}

async function byKey(data) {
  const client = await findClient({ key: String(data.key || '') });
  if (!client) throw new ApiError('CLIENT_NOT_FOUND');
  return client;
}

const amountOf = (value) => {
  if (value === '' || value === null) return null;
  const n = Number(value);
  if (!(n >= 0)) throw new ApiError('INVALID_AMOUNT');
  return round2(n);
};

// income and/or tax for one month; '' or null clears a figure
async function setMonth(caller, data) {
  const client = await byKey(data);
  const month = checkMonth(data.month);
  const ref = monthRef(client.id, month);
  if (data.income !== undefined) {
    const income = amountOf(data.income);
    if (income === null) await ref.set({ month, income: null }, { merge: true });
    else {
      const entries = [{ date: `${month}-01`, currency: 'GEL', amount: income, rate: 1, gel: income, manual: true }];
      await ref.set({ month, income, entries, source: 'manual', reportedBy: caller.email || caller.uid, reportedAt: now() }, { merge: true });
    }
  }
  if (data.tax !== undefined) await ref.set({ month, tax: amountOf(data.tax), taxUpdatedAt: now() }, { merge: true });
  return toMonth({ month, ...(await ref.get()).data() });
}

async function setDebt(data) {
  const client = await byKey(data);
  const amount = amountOf(data.amount ?? 0) ?? 0;
  await clientRef(client.id).update({ outstandingDebt: amount, debtUpdatedAt: now() });
  return { key: client.id, outstandingDebt: amount };
}

async function setContacts(data) {
  const client = await byKey(data);
  const changes = { updatedAt: now() };
  if (data.email !== undefined) {
    const email = cleanText(data.email, 200).toLowerCase();
    if (email && !validEmail(email)) throw new ApiError('INVALID_EMAIL');
    changes.email = email;
  }
  if (data.telegramId !== undefined) {
    const id = cleanText(data.telegramId, 20);
    if (id && !/^-?\d+$/.test(id)) throw new ApiError('INVALID_TELEGRAM_ID');
    changes.telegramId = id;
  }
  if (data.deliveryMethod !== undefined) {
    if (!['telegram', 'email'].includes(data.deliveryMethod)) throw new ApiError('INVALID_REQUEST');
    changes.deliveryMethod = data.deliveryMethod;
  }
  if (data.registrationId !== undefined) {
    const rid = cleanText(data.registrationId, 20).replace(/\s+/g, '');
    if (rid && !/^\d{9,11}$/.test(rid)) throw new ApiError('INVALID_REGISTRATION_ID');
    changes.registrationId = rid;
  }
  await clientRef(client.id).update(changes);
  return toClient({ ...client, ...changes });
}

// ended: the client cancelled; they stay in the years they have figures for
async function setStatus(data) {
  const client = await byKey(data);
  if (!['active', 'ended'].includes(data.status)) throw new ApiError('INVALID_REQUEST');
  const changes = { status: data.status, endedAt: data.status === 'ended' ? now() : null, updatedAt: now() };
  await clientRef(client.id).update(changes);
  return toClient({ ...client, ...changes });
}

async function verifyPending(data, env) {
  const client = await verify(String(data.key || ''));
  const cfg = await settings();
  const chat = cfg.sending === 'live' ? client.telegramId : cfg.testTelegramId;
  if (chat && env.telegramToken) {
    await sendMessage(env.telegramToken, chat, '✅ Your registration with AI Law is verified. You can now report your income from the main menu.').catch(() => {});
  }
  return toClient(client);
}

const EDITABLE = ['sending', 'feePerDeclaration', 'bankAccount', 'testTelegramId', 'testEmail', 'notifyEmail'];

async function updateSettings(data) {
  const changes = {};
  for (const key of EDITABLE) if (data[key] !== undefined) changes[key] = data[key];
  if (changes.sending !== undefined && !['test', 'live'].includes(changes.sending)) throw new ApiError('INVALID_REQUEST');
  if (changes.feePerDeclaration !== undefined) changes.feePerDeclaration = Number(changes.feePerDeclaration);
  if (Object.keys(changes).length) await TOOL.set({ ...changes, updatedAt: now() }, { merge: true });
  const cfg = await settings();
  return Object.fromEntries(EDITABLE.map((k) => [k, cfg[k]]));
}

// ---------- The admin's chat ----------
// Questions are answered straight away; every change is proposed as a card
// and runs the admin action above only when the admin presses Confirm.

const keyProp = { type: 'string', description: 'the client key from declarations_find (registration ID or ID-… code)' };
const monthProp = { type: 'string', description: 'yyyy-MM' };
const money2 = (n) => (n == null ? '—' : `${Number(n).toFixed(2)} GEL`);

async function adminTool(run) {
  try {
    return await run();
  } catch (err) {
    if (err instanceof ApiError) return { error: err.code };
    throw err;
  }
}

// The client a proposal is about, named on its card
async function named(key) {
  const client = await findClient({ key: String(key || '') });
  if (!client) throw new ApiError('CLIENT_NOT_FOUND');
  return client;
}
const who = (c) => `${c.name}${c.registrationId ? ' (' + c.registrationId + ')' : ''}`;

const adminTools = {
  declarations_overview: {
    sides: ['admin'],
    description:
      '1% declarations at a glance for the month clients report now: who has not reported, whose declaration ' +
      'is still to file, who registered and waits for verification, and the sending mode (test or live).',
    parameters: { type: 'object', properties: {} },
    run: () =>
      adminTool(async () => {
        const month = reportingMonth();
        const cfg = await settings();
        const groups = { notReported: [], toFile: [], toVerify: [] };
        for (const c of await allClients()) {
          if (c.status === 'ended') continue;
          if (c.id === cfg.testRegistrationId && cfg.sending === 'live') continue;
          if (c.status === 'pending') {
            groups.toVerify.push({ key: c.id, name: c.name });
            continue;
          }
          const m = (await monthRef(c.id, month).get()).data();
          if (!m || m.income == null) groups.notReported.push({ key: c.id, name: c.name });
          else if (!m.deliveredAt && !m.declarationFile) groups.toFile.push({ key: c.id, name: c.name, income: m.income });
        }
        return { reportingMonth: month, sending: cfg.sending, ...groups };
      }),
  },
  declarations_find: {
    sides: ['admin'],
    description:
      'Finds 1% declarations clients by name, registration ID, ID-… code, Telegram username or email ' +
      '(empty = everyone). Gives each one\'s key (needed by the other tools), status, contacts, delivery method and debt.',
    parameters: { type: 'object', properties: { query: { type: 'string' } } },
    run: (ctx, args) =>
      adminTool(async () => {
        const words = String(args?.query || '').toLowerCase().split(/\s+/).filter(Boolean);
        return (await allClients())
          .filter((c) => {
            const text = [c.name, c.id, c.registrationId, c.clientId, c.telegramUsername, c.email].join(' ').toLowerCase();
            return words.every((w) => text.includes(w));
          })
          .slice(0, 30)
          .map((c) => {
            const t = toClient(c);
            const { months: _, ...rest } = t;
            return rest;
          });
      }),
  },
  declarations_months: {
    sides: ['admin'],
    description: "One client's months for a year: income, tax, where the report came from, and whether the declaration was delivered.",
    parameters: { type: 'object', properties: { key: keyProp, year: { type: 'string' } }, required: ['key'] },
    run: (ctx, args) =>
      adminTool(async () => {
        const client = await named(args.key);
        const year = /^\d{4}$/.test(String(args.year || '')) ? String(args.year) : reportingMonth().slice(0, 4);
        const list = (await months(client.id, year)).map(toMonth).sort((a, b) => a.month.localeCompare(b.month));
        const total = (k) => round2(list.reduce((t, m) => t + (m[k] || 0), 0));
        return { client: who(client), year, months: list, incomeTotal: total('income'), taxTotal: total('tax') };
      }),
  },
  declarations_set_month: {
    sides: ['admin'],
    description:
      "Proposes setting a month's income and/or tax (GEL) for a client; leave out a figure to keep it. The tax is " +
      'what rs.ge shows when filing. Shows a Confirm card; nothing changes until the admin confirms.',
    parameters: {
      type: 'object',
      properties: { key: keyProp, month: monthProp, income: { type: 'number' }, tax: { type: 'number' } },
      required: ['key', 'month'],
    },
    run: (ctx, args) =>
      adminTool(async () => {
        const c = await named(args.key);
        checkMonth(args.month);
        const data = { key: c.id, month: args.month };
        const lines = [];
        if (typeof args.income === 'number') {
          data.income = args.income;
          lines.push(`Income: ${money2(args.income)}`);
        }
        if (typeof args.tax === 'number') {
          data.tax = args.tax;
          lines.push(`Tax: ${money2(args.tax)}`);
        }
        if (!lines.length) return { error: 'NOTHING_TO_CHANGE' };
        const old = (await monthRef(c.id, args.month).get()).data() || {};
        lines.push(`Before: income ${money2(old.income)}, tax ${money2(old.tax)}`);
        return proposeAction(ctx, { action: 'declarations:setMonth', data, title: `${monthName(args.month)} for ${who(c)}`, lines });
      }),
  },
  declarations_set_status: {
    sides: ['admin'],
    description:
      "Proposes ending a client's 1% service (they cancelled: status ended, they leave the table) or starting it again " +
      '(active). Shows a Confirm card.',
    parameters: { type: 'object', properties: { key: keyProp, status: { type: 'string', enum: ['active', 'ended'] } }, required: ['key', 'status'] },
    run: (ctx, args) =>
      adminTool(async () => {
        const c = await named(args.key);
        const ending = args.status === 'ended';
        return proposeAction(ctx, {
          action: 'declarations:setStatus',
          data: { key: c.id, status: ending ? 'ended' : 'active' },
          title: ending ? `End the 1% service for ${who(c)}` : `Start the 1% service again for ${who(c)}`,
          lines: ending
            ? ['They can no longer report income.', 'They move to the Ended filter; their months and files stay.']
            : ['They can report income again and show in the table.'],
        });
      }),
  },
  declarations_set_debt: {
    sides: ['admin'],
    description: "Proposes setting a client's outstanding debt on rs.ge (GEL). Shows a Confirm card.",
    parameters: { type: 'object', properties: { key: keyProp, amount: { type: 'number' } }, required: ['key', 'amount'] },
    run: (ctx, args) =>
      adminTool(async () => {
        const c = await named(args.key);
        return proposeAction(ctx, {
          action: 'declarations:setDebt',
          data: { key: c.id, amount: args.amount },
          title: `Outstanding debt for ${who(c)}`,
          lines: [`New: ${money2(args.amount)}`, `Before: ${money2(c.outstandingDebt)}`],
        });
      }),
  },
  declarations_set_contacts: {
    sides: ['admin'],
    description:
      "Proposes changing a client's registration ID, Telegram chat id, email and/or how declarations are sent " +
      '(deliveryMethod telegram or email). Only the fields given change. Shows a Confirm card.',
    parameters: {
      type: 'object',
      properties: {
        key: keyProp,
        registrationId: { type: 'string' },
        telegramId: { type: 'string' },
        email: { type: 'string' },
        deliveryMethod: { type: 'string', enum: ['telegram', 'email'] },
      },
      required: ['key'],
    },
    run: (ctx, args) =>
      adminTool(async () => {
        const c = await named(args.key);
        const data = { key: c.id };
        const lines = [];
        const labels = { registrationId: 'Registration ID', telegramId: 'Telegram chat id', email: 'Email', deliveryMethod: 'Send declarations by' };
        for (const k of Object.keys(labels)) {
          if (args[k] === undefined) continue;
          data[k] = args[k];
          lines.push(`${labels[k]}: ${args[k] || '(empty)'}  (was ${(k === 'deliveryMethod' ? methodOf(c) : c[k]) || 'empty'})`);
        }
        if (!lines.length) return { error: 'NOTHING_TO_CHANGE' };
        return proposeAction(ctx, { action: 'declarations:setContacts', data, title: `Details of ${who(c)}`, lines });
      }),
  },
  declarations_add_client: {
    sides: ['admin'],
    description:
      'Proposes putting a client on the 1% list: name, and optionally registration ID, Telegram chat id, email, ' +
      'serviceStart (yyyy-MM), deliveryMethod (telegram/email), clientId (an existing ID-… client record; without it ' +
      'a new client record and folder are made). Shows a Confirm card.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        registrationId: { type: 'string' },
        telegramId: { type: 'string' },
        email: { type: 'string' },
        serviceStart: monthProp,
        deliveryMethod: { type: 'string', enum: ['telegram', 'email'] },
        clientId: { type: 'string' },
      },
      required: ['name'],
    },
    run: (ctx, args) =>
      adminTool(async () => {
        const data = { ...args, serviceStart: args.serviceStart || reportingMonth() };
        return proposeAction(ctx, {
          action: 'declarations:add',
          data,
          title: `Add ${args.name} to the 1% list`,
          lines: [
            `Registration ID: ${args.registrationId || '—'}`,
            `Telegram: ${args.telegramId || '—'} · Email: ${args.email || '—'}`,
            `Send by: ${args.deliveryMethod || 'telegram'} · From: ${data.serviceStart}`,
            args.clientId ? `Client record: ${args.clientId}` : 'A new client record and folder are made',
          ],
        });
      }),
  },
  declarations_delete_client: {
    sides: ['admin'],
    description:
      'Proposes deleting a client from the 1% list completely, with every month (for tests and mistakes; for a client ' +
      'who cancelled use declarations_set_status ended). files=true also deletes their declaration PDFs. Shows a Confirm card.',
    parameters: { type: 'object', properties: { key: keyProp, files: { type: 'boolean' } }, required: ['key'] },
    run: (ctx, args) =>
      adminTool(async () => {
        const c = await named(args.key);
        return proposeAction(ctx, {
          action: 'declarations:delete',
          data: { key: c.id, files: args.files === true },
          title: `Delete ${who(c)} from the 1% list`,
          lines: [
            'Every month\'s figures are deleted. This can\'t be undone.',
            args.files === true ? 'Their declaration PDFs are deleted too.' : 'Their declaration PDFs stay in their folder.',
          ],
          danger: true,
        });
      }),
  },
  declarations_resend: {
    sides: ['admin'],
    description:
      "Proposes sending a month's declaration again (the PDF already in the client's folder), by the client's delivery " +
      'method. New PDFs are uploaded on the 1% Declarations page. Shows a Confirm card.',
    parameters: { type: 'object', properties: { key: keyProp, month: monthProp }, required: ['key', 'month'] },
    run: (ctx, args) =>
      adminTool(async () => {
        const c = await named(args.key);
        checkMonth(args.month);
        const cfg = await settings();
        return proposeAction(ctx, {
          action: 'declarations:deliver',
          data: { key: c.id, month: args.month },
          title: `Send ${monthName(args.month)} to ${who(c)} again`,
          lines: [`By ${methodOf(c)}${cfg.sending !== 'live' ? ' (test mode: it comes to you)' : ''}`],
        });
      }),
  },
  declarations_verify: {
    sides: ['admin'],
    description: 'Proposes verifying a client who registered through the Telegram bot (status pending). Shows a Confirm card.',
    parameters: { type: 'object', properties: { key: keyProp }, required: ['key'] },
    run: (ctx, args) =>
      adminTool(async () => {
        const c = await named(args.key);
        if (c.status !== 'pending') return { error: 'NOT_PENDING' };
        return proposeAction(ctx, {
          action: 'declarations:verify',
          data: { key: c.id },
          title: `Verify ${who(c)}`,
          lines: ['They get a client record and folder and can report income.', 'Check their identity first.'],
        });
      }),
  },
};

// ---------- Ordering the service ----------

// A signed-in client's order puts them on the list (see enrol)
onOrderPlaced('small-business-declarations', (order, client) => enrol(order, client, order.details || {}));

// ---------- The plugin ----------

export default {
  id: 'small-business-declarations',
  sides: ['client', 'admin'],
  actions: {
    client: {
      'declarations:my': (caller, data) => myDeclarations(caller, data),
      'declarations:report': (caller, data) => reportFromSite(caller, data),
      'declarations:draft': async (caller, data) => {
        const d = await ownDraft(caller, data.draftId);
        return { month: d.month, status: d.status, entries: d.entries.map(({ date, currency, amount }) => ({ date, currency, amount })) };
      },
      'declarations:confirm': (caller, data) => confirmDraft(caller, data),
    },
    admin: {
      'declarations:list': (caller, data) => list(data),
      'declarations:counts': () => counts(),
      'declarations:setMonth': (caller, data) => setMonth(caller, data),
      'declarations:setDebt': (caller, data) => setDebt(data),
      'declarations:setContacts': (caller, data) => setContacts(data),
      'declarations:setStatus': (caller, data) => setStatus(data),
      'declarations:add': async (caller, data) => toClient(await addClient(data)),
      'declarations:delete': (caller, data) => deleteClient(String(data.key || ''), data.files === true),
      'declarations:verify': (caller, data, env) => verifyPending(data, env),
      'declarations:deliver': (caller, data, env) =>
        deliver(String(data.key || ''), String(data.month || ''), data.file || null, env),
      'declarations:settings': (caller, data) => updateSettings(data),
    },
  },
  tools: {
    ...adminTools,
    draft_declaration_income: {
      sides: ['client'],
      description:
        "Prepares a 1% small-business declaration client's income for the previous month (the only month " +
        'they can report) from what they wrote. Each entry is one payment received: date (yyyy-MM-dd, within ' +
        'that month), currency (GEL, USD, EUR or GBP) and amount exactly as the client gave it; foreign currency ' +
        'is converted at the National Bank rate of that day. zero=true for a month without income. Ask first ' +
        'when a date, currency or amount is unclear; never guess. This does NOT save anything: it shows the ' +
        'client a card with the entries and the total, and only their Confirm button saves it. Tell them to ' +
        'check the card and press Confirm (or Edit to correct it); never say the income is saved.',
      parameters: {
        type: 'object',
        properties: {
          zero: { type: 'boolean' },
          entries: {
            type: 'array',
            items: {
              type: 'object',
              properties: { date: { type: 'string' }, currency: { type: 'string' }, amount: { type: 'number' } },
              required: ['date', 'currency', 'amount'],
            },
          },
        },
      },
      run: async (ctx, args) => {
        if (!ctx.caller.signedIn) return { error: 'SIGN_IN_REQUIRED' };
        try {
          const d = await makeDraft(ctx, args);
          return { shownToClient: true, month: monthName(d.month), totalGel: d.income, saved: false };
        } catch (err) {
          if (err instanceof ApiError) return { error: err.code };
          throw err;
        }
      },
    },
    get_declaration_info: {
      sides: ['client'],
      description:
        "A 1% small-business declaration client's own figures: income and tax (as filed) per month for a year, " +
        'whether each declaration was delivered, outstanding debt on rs.ge, and which month they can report now.',
      parameters: { type: 'object', properties: { year: { type: 'string' } } },
      run: async (ctx, args) => {
        if (!ctx.caller.signedIn) return { error: 'SIGN_IN_REQUIRED' };
        try {
          const client = await ownClient(ctx.caller);
          const year = /^\d{4}$/.test(String(args?.year || '')) ? String(args.year) : reportingMonth().slice(0, 4);
          const c = toClient(client, await months(client.id, year));
          return {
            reportingMonth: reportingMonth(),
            outstandingDebt: c.outstandingDebt,
            months: c.months.map((m) => ({ month: m.month, income: m.income, tax: m.tax, delivered: !!m.deliveredAt })),
          };
        } catch (err) {
          if (err instanceof ApiError) return { error: err.code };
          throw err;
        }
      },
    },
  },
};
