// ==========================================================
// Small business declarations: the data
// Everything lives in ServiceTools/SmallBusinessDeclarations:
//   (the document itself)   settings: tax rate, fee, bank account, sending
//   Clients/{registration ID}
//       name, registrationId, clientId (ID-… of the client record),
//       telegramId, telegramUsername, email, status (active | pending),
//       serviceStart, outstandingDebt
//   Clients/{…}/Months/{yyyy-MM}
//       income, tax, serviceFee, source, entries (one per income received),
//       reportedAt, declarationFile, deliveredAt, deliveredVia
//   BotState/{telegram chat id}    where a Telegram conversation is
//   Drafts/{id}    income the website chat read from a client's message,
//                  saved only when the client presses Confirm
// Clients report income through any channel (Telegram, the website chat,
// later email or WhatsApp); every channel ends up in reportIncome().
// ==========================================================

import { ApiError, cleanText, db, formatDate, newCode, now } from '../../core/app.js';
import { makeFolder } from '../../core/files.js';

export const TOOL = db.doc('ServiceTools/SmallBusinessDeclarations');
export const FOLDER = 'SmallBusinessDeclarations';

// What the settings fall back to when the tool document leaves them out
const DEFAULTS = {
  taxRate: 0.01,
  feePerDeclaration: 50,
  bankAccount: 'GE33BG0000000538123818',
  // test: every message goes to testTelegramId / testEmail; live: to clients
  sending: 'test',
  testTelegramId: '5226827780',
  testEmail: 'gochaokreshidze@gmail.com',
  // The client the test chat acts as, so real records stay untouched
  testRegistrationId: '000000000',
  // Who hears about new registrations
  notifyEmail: 'gochaokreshidze@gmail.com',
};

export async function settings() {
  return { ...DEFAULTS, ...((await TOOL.get()).data() || {}) };
}

// ---------- Small helpers ----------

export const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
export const clientRef = (registrationId) => TOOL.collection('Clients').doc(String(registrationId));
export const monthRef = (registrationId, month) => clientRef(registrationId).collection('Months').doc(month);

const one = (snap) => (snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() });

export function checkMonth(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || ''))) throw new ApiError('INVALID_MONTH');
  return month;
}

// The month clients may report: always the previous one (Tbilisi time)
export function reportingMonth(date = now()) {
  const [y, m] = formatDate(date, 'yyyy-MM').split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

export const lastDay = (month) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

// ---------- Finding a client ----------

// By whatever the channel knows about the sender
export async function findClient({ registrationId, telegramId, clientId, email }) {
  const clients = TOOL.collection('Clients');
  if (registrationId) {
    const snap = await clientRef(registrationId).get();
    return snap.exists ? { id: snap.id, ...snap.data() } : null;
  }
  if (telegramId) return one(await clients.where('telegramId', '==', String(telegramId)).limit(1).get());
  if (clientId) return one(await clients.where('clientId', '==', String(clientId)).limit(1).get());
  if (email) return one(await clients.where('email', '==', String(email).toLowerCase()).limit(1).get());
  return null;
}

// Only verified (active) clients may report or receive
export function requireActive(client) {
  if (!client) throw new ApiError('NOT_A_DECLARATIONS_CLIENT');
  if (client.status === 'pending') throw new ApiError('VERIFICATION_PENDING');
  return client;
}

// ---------- Reporting income ----------

// entries: [{ date: 'yyyy-MM-dd', currency, amount, rate, gel }] (already in GEL),
// or [] for a zero-income month. The month's total is replaced, as the
// Telegram bot always did ("Finish" saves the month's total).
// note: the client's own words, kept with the report (e.g. the chat message)
export async function reportIncome(client, { month, entries = [], source, by = '', note = '' }) {
  requireActive(client);
  checkMonth(month);
  const { taxRate } = await settings();
  const income = round2(entries.reduce((sum, e) => sum + Number(e.gel || 0), 0));
  const ref = monthRef(client.registrationId, month);
  const before = (await ref.get()).data() || {};
  const record = {
    month,
    income,
    tax: round2(income * taxRate),
    entries,
    source,
    reportedBy: by,
    note: String(note || '').slice(0, 2000),
    reportedAt: now(),
  };
  await ref.set(record, { merge: true });
  return { ...before, ...record, previousIncome: before.income ?? null };
}

// ---------- Reading ----------

export async function months(registrationId, year) {
  let query = clientRef(registrationId).collection('Months');
  if (year) query = query.where('month', '>=', `${year}-01`).where('month', '<=', `${year}-12`);
  return (await query.get()).docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function allClients() {
  return (await TOOL.collection('Clients').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ---------- Registering ----------

// From the Telegram bot: an existing registration ID gets the Telegram
// account linked; a new one becomes a pending client until it is verified
export async function register({ registrationId, name, telegramId, telegramUsername }) {
  const rid = cleanText(registrationId, 20, 'INVALID_REGISTRATION_ID').replace(/\s+/g, '');
  if (!/^\d{9,11}$/.test(rid)) throw new ApiError('INVALID_REGISTRATION_ID');
  const existing = await findClient({ registrationId: rid });
  const link = { telegramId: String(telegramId || ''), telegramUsername: telegramUsername || '', updatedAt: now() };
  if (existing) {
    await clientRef(rid).update(link);
    return { ...existing, ...link, isNew: false };
  }
  const fullName = cleanText(name, 100, 'INVALID_NAME').replace(/\s+/g, ' ');
  if (fullName.length < 3 || !/\p{L}/u.test(fullName)) throw new ApiError('INVALID_NAME');
  const record = {
    name: fullName,
    registrationId: rid,
    clientId: '',
    email: '',
    status: 'pending',
    active: true,
    serviceStart: '',
    outstandingDebt: 0,
    createdAt: now(),
    ...link,
  };
  await clientRef(rid).set(record);
  return { id: rid, ...record, isNew: true };
}

// After the identity check: a client record (verified) and a folder
export async function verify(registrationId) {
  const client = await findClient({ registrationId });
  if (!client) throw new ApiError('CLIENT_NOT_FOUND');
  let clientId = client.clientId;
  if (!clientId) {
    clientId = await newCode('ID', 'Clients');
    const words = client.name.split(/\s+/);
    const folder = `clients/verified/${clientId} - ${client.name}`;
    await db.doc('Clients/' + clientId).set({
      clientId,
      type: 'verified',
      status: 'active',
      role: 'client',
      firstName: words.length > 1 ? words[0] : client.name,
      lastName: words.length > 1 ? words.slice(1).join(' ') : '',
      displayName: client.name,
      email: client.email || '',
      emailVerified: false,
      phone: '',
      passport: '',
      idNumber: client.registrationId,
      address: '',
      notes: 'Registered through the 1% declarations Telegram bot',
      userId: '',
      providers: {},
      photoUrl: '',
      folder,
      createdAt: now(),
      updatedAt: now(),
      lastLoginAt: null,
    });
    await makeFolder(`${folder}/${FOLDER}`);
  }
  const changes = { clientId, status: 'active', serviceStart: client.serviceStart || formatDate(now(), 'yyyy-MM'), updatedAt: now() };
  await clientRef(registrationId).update(changes);
  return { ...client, ...changes };
}
