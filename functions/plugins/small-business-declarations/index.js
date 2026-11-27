// ==========================================================
// Plugin: small business declarations (client + admin)
// The 1% declarations service as one tool:
//   1. income comes in from any channel: the Telegram bot (telegram.js),
//      the website chat (tools below), the website itself, or AI Law by hand
//   2. AI Law sees every client's months (admin:declarations:list)
//   3. AI Law files the declaration on rs.ge, uploads the PDF and it is
//      delivered: saved in the client's folder and sent (delivery.js)
// Data: data.js. Contract signing is not here: it belongs to checkout.
// Client:
//   declarations:my       the signed-in client's months and debt
//   declarations:report   report last month's income from the website
// Admin:
//   declarations:list           every client with one year's months
//   declarations:setIncome      type in a month's income by hand
//   declarations:setDebt        outstanding debt, as shown on rs.ge
//   declarations:setContacts    Telegram chat id / email for a client
//   declarations:verify         a pending (self-registered) client → active
//   declarations:deliver        upload a declaration → folder → client
//   declarations:settings       sending test/live, fee, bank account …
// ==========================================================

import { ApiError, cleanText, now, validEmail } from '../../core/app.js';
import { clientByUid } from '../../core/records.js';
import {
  TOOL,
  allClients,
  checkMonth,
  clientRef,
  findClient,
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
    registrationId: c.registrationId,
    name: c.name,
    clientId: c.clientId || '',
    status: c.status || 'active',
    telegramId: c.telegramId || '',
    telegramUsername: c.telegramUsername || '',
    email: c.email || '',
    serviceStart: c.serviceStart || '',
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

async function reportFromSite(caller, data, source) {
  const client = await ownClient(caller);
  const month = reportingMonth();
  const entries = data.zero ? [] : await toGel(Array.isArray(data.entries) ? data.entries.slice(0, 50) : [], month);
  if (!data.zero && !entries.length) throw new ApiError('NO_INCOME_ENTRIES');
  const saved = await reportIncome(client, { month, entries, source, by: caller.uid });
  return { month, income: saved.income, tax: saved.tax, previousIncome: saved.previousIncome };
}

// ---------- Admin ----------

async function list(data) {
  const year = /^\d{4}$/.test(String(data.year || '')) ? String(data.year) : reportingMonth().slice(0, 4);
  const clients = await allClients();
  const cfg = await settings();
  const rows = [];
  for (const c of clients) {
    // The test client only shows while testing
    if (c.registrationId === cfg.testRegistrationId && cfg.sending === 'live') continue;
    rows.push(toClient(c, await months(c.registrationId, year)));
  }
  return {
    year,
    reportingMonth: reportingMonth(),
    sending: cfg.sending,
    clients: rows.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

async function setIncome(caller, data) {
  const client = await findClient({ registrationId: String(data.registrationId || '') });
  const month = checkMonth(data.month);
  const income = Number(data.income);
  if (!(income >= 0)) throw new ApiError('INVALID_AMOUNT');
  const entries = [{ date: `${month}-01`, currency: 'GEL', amount: income, rate: 1, gel: round2(income), manual: true }];
  return toMonth(await reportIncome(client, { month, entries, source: 'manual', by: caller.email || caller.uid }));
}

async function setDebt(data) {
  const client = await findClient({ registrationId: String(data.registrationId || '') });
  if (!client) throw new ApiError('CLIENT_NOT_FOUND');
  const amount = Number(data.amount);
  if (!(amount >= 0)) throw new ApiError('INVALID_AMOUNT');
  await clientRef(client.registrationId).update({ outstandingDebt: round2(amount), debtUpdatedAt: now() });
  return { registrationId: client.registrationId, outstandingDebt: round2(amount) };
}

async function setContacts(data) {
  const client = await findClient({ registrationId: String(data.registrationId || '') });
  if (!client) throw new ApiError('CLIENT_NOT_FOUND');
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
  await clientRef(client.registrationId).update(changes);
  return toClient({ ...client, ...changes });
}

async function verifyPending(data, env) {
  const client = await verify(String(data.registrationId || ''));
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

// ---------- The plugin ----------

export default {
  id: 'small-business-declarations',
  sides: ['client', 'admin'],
  actions: {
    client: {
      'declarations:my': async (caller, data) => {
        const client = await ownClient(caller);
        const year = /^\d{4}$/.test(String(data.year || '')) ? String(data.year) : undefined;
        return { reportingMonth: reportingMonth(), ...toClient(client, await months(client.registrationId, year)) };
      },
      'declarations:report': (caller, data) => reportFromSite(caller, data, 'website'),
    },
    admin: {
      'declarations:list': (caller, data) => list(data),
      'declarations:setIncome': (caller, data) => setIncome(caller, data),
      'declarations:setDebt': (caller, data) => setDebt(data),
      'declarations:setContacts': (caller, data) => setContacts(data),
      'declarations:verify': (caller, data, env) => verifyPending(data, env),
      'declarations:deliver': (caller, data, env) =>
        deliver(String(data.registrationId || ''), String(data.month || ''), data.file || null, env),
      'declarations:settings': (caller, data) => updateSettings(data),
    },
  },
  tools: {
    report_declaration_income: {
      sides: ['client'],
      description:
        "Records a 1% small-business declaration client's income for the previous month (the only month " +
        'they can report). Confirm the entries with the client first. Each entry is one payment received: ' +
        'date (yyyy-MM-dd, within that month), currency (GEL, USD, EUR or GBP) and amount; foreign currency ' +
        'is converted at the National Bank rate of that day. zero=true for a month without income. ' +
        "The month's total is replaced by what is sent.",
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
          const r = await reportFromSite(ctx.caller, args || {}, 'chat');
          return { ...r, monthName: monthName(r.month) };
        } catch (err) {
          if (err instanceof ApiError) return { error: err.code };
          throw err;
        }
      },
    },
    get_declaration_info: {
      sides: ['client'],
      description:
        "A 1% small-business declaration client's own figures: income and tax per month for a year, " +
        'whether each declaration was delivered, outstanding debt on rs.ge, and which month they can report now.',
      parameters: { type: 'object', properties: { year: { type: 'string' } } },
      run: async (ctx, args) => {
        if (!ctx.caller.signedIn) return { error: 'SIGN_IN_REQUIRED' };
        try {
          const client = await ownClient(ctx.caller);
          const year = /^\d{4}$/.test(String(args?.year || '')) ? String(args.year) : reportingMonth().slice(0, 4);
          const c = toClient(client, await months(client.registrationId, year));
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
