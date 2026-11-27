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
//   declarations:setMonth       a month's income and/or tax, by hand (the
//                               tax is always typed in from rs.ge)
//   declarations:setDebt        outstanding debt, as shown on rs.ge
//   declarations:setContacts    registration ID, Telegram chat id, email
//   declarations:setStatus      active / ended (the client cancelled)
//   declarations:verify         a pending (self-registered) client → active
//   declarations:deliver        upload a declaration → folder → client
//   declarations:settings       sending test/live, fee, bank account …
// Ordering the service on the website puts the client on the list at once
// (onOrderPlaced below): no verification, no wait for payment.
// ==========================================================

import { ApiError, cleanKey, cleanText, now, validEmail } from '../../core/app.js';
import { addPart } from '../../core/chat.js';
import { onOrderPlaced } from '../../core/orders.js';
import { clientByUid } from '../../core/records.js';
import {
  FOLDER,
  TOOL,
  allClients,
  checkMonth,
  clientRef,
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
import { deliver, monthName } from './delivery.js';
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
// current year, every active client (a new one has no figures yet). An ended
// client drops off from the year after.
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
    const ended = c.status === 'ended' && iso(c.endedAt).slice(0, 4) < year;
    const listed = list.length || (year >= current && started && !ended && c.status !== 'ended');
    if (listed) rows.push(toClient(c, list));
  }
  return {
    year,
    reportingMonth: reportingMonth(),
    sending: cfg.sending,
    clients: rows.sort((a, b) => a.name.localeCompare(b.name)),
  };
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
      'declarations:setMonth': (caller, data) => setMonth(caller, data),
      'declarations:setDebt': (caller, data) => setDebt(data),
      'declarations:setContacts': (caller, data) => setContacts(data),
      'declarations:setStatus': (caller, data) => setStatus(data),
      'declarations:verify': (caller, data, env) => verifyPending(data, env),
      'declarations:deliver': (caller, data, env) =>
        deliver(String(data.key || ''), String(data.month || ''), data.file || null, env),
      'declarations:settings': (caller, data) => updateSettings(data),
    },
  },
  tools: {
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
