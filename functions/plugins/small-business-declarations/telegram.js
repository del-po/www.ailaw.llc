// ==========================================================
// Small business declarations: the Telegram bot
// The same menu clients know from the old bot:
//   📊 Report Income        previous month only; zero, or one or more
//                            amounts (day, currency, amount → GEL at the
//                            NBG rate); "Finish" saves the month's total
//   📥 Receive Information  past declarations (PDF), income, tax,
//                            outstanding debt
//   🧾 Register as Client   registration ID + full name → pending until
//                            AI Law verifies them
// Telegram calls handleUpdate() for every message and button press; where
// each chat is in a conversation is kept in BotState/{chat id}.
// While sending is "test", the bot only talks to the test chat and uses the
// test client (testRegistrationId), so real records stay untouched.
// ==========================================================

import { ApiError, COMPANY, log, now } from '../../core/app.js';
import { listFolder, readFile } from '../../core/files.js';
import { sendMail } from '../../core/send.js';
import {
  TOOL,
  findClient,
  lastDay,
  months,
  register,
  reportIncome,
  reportingMonth,
  round2,
  settings,
} from './data.js';
import { clientFolder, monthName } from './delivery.js';
import { CURRENCIES, gelRate } from './rates.js';
import { answerCallback, sendDocument, sendMessage } from './telegram-api.js';

const CONTACT = 'Please contact our lawyer Gocha Okreshidze @ailawllc.';
const WELCOME = "👋 Welcome to @ailawllc's 1% Declarations Bot. Tap an option to proceed.";
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// ---------- Keyboards ----------

const button = (text, data) => ({ text, callback_data: data });
const rows = (buttons, size) => buttons.reduce((all, b, i) => (i % size ? all[all.length - 1].push(b) : all.push([b]), all), []);

const MAIN = [
  [button('📊 Report Income', 'r')],
  [button('📥 Receive Information', 'ri')],
  [button('🧾 Register as Client', 'rg')],
];
const TYPE = [[button('Specific Amount', 'dt:amount')], [button('Zero-Income', 'dt:zero')], [button('⬅️ Back to Main Menu', 'bk')]];
const RECEIVE = [
  [button('📄 Past Declarations (PDF)', 'rt:pdf')],
  [button('📈 Income Information', 'rt:income')],
  [button('🧾 Tax Information', 'rt:tax')],
  [button('💳 Outstanding Debt', 'od')],
  [button('⬅️ Back to Main Menu', 'bk')],
];
const days = (month) => [
  ...rows(Array.from({ length: lastDay(month) }, (_, i) => button(String(i + 1).padStart(2, '0'), `dy:${i + 1}`)), 7),
  [button('⬅️ Back', 'bk:type')],
];
const currencies = () => [CURRENCIES.map((c) => button(c, `cc:${c}`)), [button('⬅️ Back', 'bk:day')]];
const afterEntry = (name) => [[button(`➕ Add another income for ${name}`, 'aa')], [button(`🏁 Finish Report for ${name}`, 'fn')]];
const years = (list, prefix) => [...rows(list.map((y) => button(String(y), `${prefix}:${y}`)), 3), [button('⬅️ Back', 'ri')]];

// ---------- Conversation state ----------

const stateRef = (chatId) => TOOL.collection('BotState').doc(String(chatId));
const loadState = async (chatId) => (await stateRef(chatId).get()).data() || {};
const saveState = (chatId, state) => stateRef(chatId).set({ ...state, updatedAt: now() });
const clearState = (chatId) => stateRef(chatId).delete();

// ---------- Entry point ----------

export async function handleUpdate(update, env) {
  const token = env.telegramToken;
  const message = update.message;
  const callback = update.callback_query;
  const from = message?.from || callback?.from;
  const chatId = message?.chat?.id ?? callback?.message?.chat?.id;
  if (!chatId || !from) return;
  if (callback) await answerCallback(token, callback.id);

  const cfg = await settings();
  const testing = cfg.sending !== 'live';
  if (testing && String(chatId) !== String(cfg.testTelegramId)) {
    await sendMessage(token, chatId, `🛠 This bot is being tested and isn't open yet.\n(Your chat id: ${chatId})`);
    return;
  }

  const say = (text, keyboard) => sendMessage(token, chatId, text, keyboard);
  const ctx = {
    chatId,
    from,
    say,
    token,
    env,
    cfg,
    // While testing, the test chat acts as the test client
    client: () => (testing ? findClient({ registrationId: cfg.testRegistrationId }) : findClient({ telegramId: chatId })),
  };

  try {
    if (callback) await onButton(ctx, String(callback.data || ''));
    else if (typeof message.text === 'string') await onText(ctx, message.text.trim());
  } catch (err) {
    await log('declarations bot ' + chatId, err);
    await say(`⚠️ Something went wrong. ${CONTACT}`, MAIN);
    await clearState(chatId);
  }
}

// ---------- Text messages ----------

async function onText(ctx, text) {
  if (text === '/start') {
    await clearState(ctx.chatId);
    return ctx.say(WELCOME, MAIN);
  }
  if (text === '/cancel') {
    await clearState(ctx.chatId);
    return ctx.say('Main menu — choose an option:', MAIN);
  }
  const state = await loadState(ctx.chatId);
  if (state.step === 'amount') return amountTyped(ctx, state, text);
  if (state.step === 'regId') return regIdTyped(ctx, state, text);
  if (state.step === 'regName') return regNameTyped(ctx, state, text);
  return ctx.say('Main menu — choose an option:', MAIN);
}

// ---------- Buttons ----------

async function onButton(ctx, data) {
  const [key, value] = data.split(':');
  const state = await loadState(ctx.chatId);
  switch (key) {
    case 'bk':
      if (value === 'type') return startReport(ctx);
      if (value === 'day') return ctx.say(`📅 Select the date you received the income in ${monthName(state.month)}:`, days(state.month));
      await clearState(ctx.chatId);
      return ctx.say('Main menu — choose an option:', MAIN);
    case 'r':
      return startReport(ctx);
    case 'dt':
      return value === 'zero' ? finishReport(ctx, { ...state, entries: [] }, true) : askDay(ctx, state);
    case 'dy':
      await saveState(ctx.chatId, { ...state, day: Number(value), step: 'currency' });
      return ctx.say('Please select the currency of your income. 👇', currencies());
    case 'cc':
      await saveState(ctx.chatId, { ...state, currency: value, step: 'amount' });
      return ctx.say(`Please enter the income amount you received in ${value} (e.g. 1234 or 1234.12)`);
    case 'aa':
      return askDay(ctx, state);
    case 'fn':
      return finishReport(ctx, state, false);
    case 'ri':
      await clearState(ctx.chatId);
      return ctx.say('What would you like to receive? 👇', RECEIVE);
    case 'rt':
      return receiveType(ctx, value);
    case 'py':
      return pdfMonths(ctx, value);
    case 'pm':
      return sendPdf(ctx, value);
    case 'yr':
      return yearFigures(ctx, state, Number(value));
    case 'od':
      return debt(ctx);
    case 'rg':
      await saveState(ctx.chatId, { step: 'regId' });
      return ctx.say('🧾 Registration\n\nPlease enter your <b>Registration ID</b> (official company/state code).\n\nSend /cancel to stop.');
    default:
      return ctx.say('Main menu — choose an option:', MAIN);
  }
}

// ---------- Report Income ----------

// Only verified clients get past this
async function activeClient(ctx) {
  const client = await ctx.client();
  if (!client) {
    await ctx.say(`⚠️ I couldn't find your client record. Tap "Register as Client" first, or ${CONTACT.toLowerCase()}`, MAIN);
    return null;
  }
  if (client.status === 'pending') {
    await ctx.say('⏳ Your registration is waiting for verification by AI Law. We will let you know once it is done.', MAIN);
    return null;
  }
  return client;
}

async function startReport(ctx) {
  if (!(await activeClient(ctx))) return;
  const month = reportingMonth();
  await saveState(ctx.chatId, { flow: 'report', month, entries: [] });
  return ctx.say(
    `🗓️ You can only file the declaration for the previous month: <b>${monthName(month)}</b>.\n\nWhat was your total income for ${monthName(month)}? 💰`,
    TYPE,
  );
}

async function askDay(ctx, state) {
  if (!state.month) return startReport(ctx);
  await saveState(ctx.chatId, { ...state, step: 'day' });
  const next = state.entries?.length ? 'the next income' : 'the income';
  return ctx.say(`📅 Select the date you received ${next} in ${monthName(state.month)}:`, days(state.month));
}

async function amountTyped(ctx, state, text) {
  if (!/^\d+(\.\d+)?$/.test(text)) return ctx.say('⚠️ Invalid format. Please enter a numerical value only, like 1234 or 1234.56.');
  const amount = Number(text);
  const date = `${state.month}-${String(state.day).padStart(2, '0')}`;
  const rate = await gelRate(state.currency, date);
  if (!rate) return ctx.say(`⚠️ I could not retrieve the exchange rate for that date. ${CONTACT}`);
  const gel = round2(amount * rate);
  const entries = [...(state.entries || []), { date, currency: state.currency, amount, rate, gel }];
  const total = round2(entries.reduce((s, e) => s + e.gel, 0));
  await saveState(ctx.chatId, { ...state, entries, step: 'entered', currency: null, day: null });
  return ctx.say(
    `✅ Entry saved: ${gel.toFixed(2)} GEL for ${date}.\n📌 Running total for ${monthName(state.month)}: ${total.toFixed(2)} GEL`,
    afterEntry(monthName(state.month)),
  );
}

async function finishReport(ctx, state, zero) {
  const client = await activeClient(ctx);
  if (!client) return;
  if (!state.month) return startReport(ctx);
  const saved = await reportIncome(client, {
    month: state.month,
    entries: state.entries || [],
    source: 'telegram',
    by: String(ctx.from.username || ctx.chatId),
  });
  await clearState(ctx.chatId);
  if (zero) return ctx.say(`✅ Zero-income declaration recorded for ${monthName(state.month)}.`, MAIN);
  const previous = saved.previousIncome === null ? '—' : Number(saved.previousIncome).toFixed(2);
  return ctx.say(`✅ Updated ${monthName(state.month)}:\nPrevious: ${previous} GEL\nNew: ${saved.income.toFixed(2)} GEL`, MAIN);
}

// ---------- Receive Information ----------

async function receiveType(ctx, type) {
  const client = await activeClient(ctx);
  if (!client) return;
  if (type === 'pdf') {
    const files = await declarationFiles(client);
    const list = [...new Set(files.map((f) => f.slice(0, 4)))].sort().reverse();
    if (!list.length) return ctx.say('I couldn\'t find any declaration PDFs in your folder.', RECEIVE);
    return ctx.say('Select the year for your declarations:', years(list, 'py'));
  }
  const list = [...new Set((await months(client.registrationId)).map((m) => m.month.slice(0, 4)))].sort().reverse();
  if (!list.length) return ctx.say('I couldn\'t find any figures for your account yet.', RECEIVE);
  await saveState(ctx.chatId, { flow: 'receive', type });
  return ctx.say('Select the year:', years(list, 'yr'));
}

// "2025.01.pdf"-style files in the client's folder
async function declarationFiles(client) {
  const folder = await clientFolder(client);
  if (!folder) return [];
  return (await listFolder(folder)).files.map((f) => f.name).filter((n) => /^\d{4}\.\d{2}\.pdf$/.test(n));
}

async function pdfMonths(ctx, year) {
  const client = await activeClient(ctx);
  if (!client) return;
  const names = (await declarationFiles(client)).filter((n) => n.startsWith(year + '.')).sort();
  const buttons = names.map((n) => button(MONTHS[Number(n.slice(5, 7)) - 1].slice(0, 3), `pm:${n.slice(0, 7)}`));
  return ctx.say(`Select the month (${year}):`, [...rows(buttons, 3), [button('⬅️ Back', 'ri')]]);
}

async function sendPdf(ctx, period) {
  const client = await activeClient(ctx);
  if (!client) return;
  const file = await readFile(`${await clientFolder(client)}/${period}.pdf`);
  if (!file) return ctx.say('⚠️ That declaration could not be found.', RECEIVE);
  await sendDocument(ctx.token, ctx.chatId, { name: `${period}.pdf`, content: file.content });
  return ctx.say('What would you like to receive? 👇', RECEIVE);
}

async function yearFigures(ctx, state, year) {
  const client = await activeClient(ctx);
  if (!client) return;
  const label = state.type === 'tax' ? 'Tax' : 'Income';
  const field = state.type === 'tax' ? 'tax' : 'income';
  const byMonth = Object.fromEntries((await months(client.registrationId, year)).map((m) => [m.month.slice(5), m[field]]));
  let total = 0;
  const lines = [`📘 ${label} information for ${year}`];
  MONTHS.forEach((name, i) => {
    const v = byMonth[String(i + 1).padStart(2, '0')];
    if (typeof v === 'number') {
      total += v;
      lines.push(`${name.slice(0, 3)}: ${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} GEL`);
    } else lines.push(`${name.slice(0, 3)}: —`);
  });
  lines.push(`\nTotal ${label} for ${year}: ${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} GEL`);
  await clearState(ctx.chatId);
  return ctx.say(lines.join('\n'), RECEIVE);
}

async function debt(ctx) {
  const client = await activeClient(ctx);
  if (!client) return;
  const amount = round2(client.outstandingDebt);
  const text =
    amount <= 0
      ? `🟢 <b>No outstanding debt</b>\n\n💳 Current outstanding debt:\n<b>${amount.toFixed(2)} GEL</b>\n\n✅ No daily penalty is accruing.`
      : `🔴 <b>Outstanding debt detected</b>\n\n💳 Current outstanding debt:\n<b>${amount.toFixed(2)} GEL</b>\n\n` +
        `⚠️ Estimated daily penalty:\n<b>${round2(amount * 0.0005).toFixed(2)} GEL per day</b>\n\n` +
        'This is calculated as 0.05% of the outstanding debt per overdue day.';
  return ctx.say(text, RECEIVE);
}

// ---------- Register as Client ----------

async function regIdTyped(ctx, state, text) {
  const regId = text.replace(/\s+/g, '');
  if (!/^\d{9,11}$/.test(regId)) return ctx.say('⚠️ Please enter a valid Registration ID.');
  const known = await findClient({ registrationId: regId });
  if (known) {
    // While testing, real records are never changed
    if (ctx.cfg.sending === 'live') await register({ registrationId: regId, telegramId: ctx.chatId, telegramUsername: ctx.from.username || '' });
    await clearState(ctx.chatId);
    return ctx.say('✅ You are already registered. I updated your details.\n\nMain menu — choose an option:', MAIN);
  }
  await saveState(ctx.chatId, { step: 'regName', regId });
  return ctx.say('🧾 Registration\n\nPlease type your <b>full name</b> exactly as it should appear in our registry.\n\nExample: John Michael Smith\n\nSend /cancel to stop.');
}

async function regNameTyped(ctx, state, text) {
  let client;
  try {
    client = await register({ registrationId: state.regId, name: text, telegramId: ctx.chatId, telegramUsername: ctx.from.username || '' });
  } catch (err) {
    if (err instanceof ApiError && err.code === 'INVALID_NAME') {
      return ctx.say('⚠️ Please enter a valid full name (at least 3 characters, must include letters).');
    }
    throw err;
  }
  await clearState(ctx.chatId);
  // AI Law hears about every new registration, to verify it
  try {
    await sendMail(
      {
        to: ctx.cfg.notifyEmail,
        subject: `New 1% declarations registration: ${client.name}`,
        text: `${client.name} (registration ID ${client.registrationId}, Telegram @${client.telegramUsername || '—'}, chat ${client.telegramId}) registered through the Telegram bot and is waiting for verification.`,
      },
      ctx.env.secrets,
    );
  } catch (err) {
    await log('declarations registration mail', err);
  }
  return ctx.say(
    `✅ Registration received.\n\nAI Law will verify your details and let you know. Questions: ${COMPANY.email}`,
    MAIN,
  );
}
