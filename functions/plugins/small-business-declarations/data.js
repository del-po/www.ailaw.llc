// ==========================================================
// Small business declarations: the data
// Everything lives in ServiceTools/SmallBusinessDeclarations:
//   (the document itself)   settings: tax rate, fee, bank account, sending
//   Clients/{key}   the key is the registration ID, or the client's ID-…
//                   code when they enrolled on the website without one
//       name, registrationId (may be filled in later), clientId (ID-… of
//       the client record), telegramId, telegramUsername, email,
//       status (active | pending | ended), serviceStart, endedAt,
//       outstandingDebt, orderNumber (the enrolment order, if any),
//       deliveryMethod (telegram | email: how declarations are sent)
//   Clients/{…}/Months/{yyyy-MM}
//       income, entries (one per income received), source, note,
//       reportedAt; tax (typed in by AI Law from rs.ge when filing),
//       serviceFee, declarationFile, deliveredAt, deliveredVia
//   BotState/{telegram chat id}    where a Telegram conversation is
//   Drafts/{id}    income the website chat read from a client's message,
//                  saved only when the client presses Confirm
// Clients report income through any channel (Telegram, the website chat,
// later email or WhatsApp); every channel ends up in reportIncome().
// ==========================================================

import { ApiError, cleanText, db, formatDate, newCode, now } from '../../core/app.js';
import { makeFolder, removeFolder } from '../../core/files.js';

export const TOOL = db.doc('ServiceTools/SmallBusinessDeclarations');
export const FOLDER = 'SmallBusinessDeclarations';

// What the settings fall back to when the tool document leaves them out
const DEFAULTS = {
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
export const clientRef = (key) => TOOL.collection('Clients').doc(String(key));
export const monthRef = (key, month) => clientRef(key).collection('Months').doc(month);

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

// By whatever the channel knows about the sender; client.id is the key
export async function findClient({ key, registrationId, telegramId, clientId, email }) {
  const clients = TOOL.collection('Clients');
  if (key) {
    const snap = await clientRef(key).get();
    return snap.exists ? { id: snap.id, ...snap.data() } : null;
  }
  if (registrationId) {
    const found = one(await clients.where('registrationId', '==', String(registrationId)).limit(1).get());
    return found || findClient({ key: registrationId });
  }
  if (telegramId) return one(await clients.where('telegramId', '==', String(telegramId)).limit(1).get());
  if (clientId) return one(await clients.where('clientId', '==', String(clientId)).limit(1).get());
  if (email) return one(await clients.where('email', '==', String(email).toLowerCase()).limit(1).get());
  return null;
}

// Only active clients may report or receive (not pending, not ended)
export function requireActive(client) {
  if (!client) throw new ApiError('NOT_A_DECLARATIONS_CLIENT');
  if (client.status === 'pending') throw new ApiError('VERIFICATION_PENDING');
  if (client.status === 'ended') throw new ApiError('SERVICE_ENDED');
  return client;
}

// ---------- Reporting income ----------

// entries: [{ date: 'yyyy-MM-dd', currency, amount, rate, gel }] (already in GEL),
// or [] for a zero-income month. The month's total is replaced, as the
// Telegram bot always did ("Finish" saves the month's total). The tax is
// not touched: AI Law types it in from rs.ge when filing.
// note: the client's own words, kept with the report (e.g. the chat message)
export async function reportIncome(client, { month, entries = [], source, by = '', note = '' }) {
  requireActive(client);
  checkMonth(month);
  const income = round2(entries.reduce((sum, e) => sum + Number(e.gel || 0), 0));
  const ref = monthRef(client.id, month);
  const before = (await ref.get()).data() || {};
  const record = {
    month,
    income,
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

export async function months(key, year) {
  let query = clientRef(key).collection('Months');
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
    await clientRef(existing.id).update(link);
    return { ...existing, ...link, isNew: false };
  }
  const fullName = cleanText(name, 100, 'INVALID_NAME').replace(/\s+/g, ' ');
  if (fullName.length < 3 || !/\p{L}/u.test(fullName)) throw new ApiError('INVALID_NAME');
  const record = {
    name: fullName,
    deliveryMethod: 'telegram',
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
export async function verify(key) {
  const client = await findClient({ key });
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
      idNumber: client.registrationId || '',
      address: '',
      notes: 'Registered through the 1% declarations Telegram bot',
      userId: '',
      providers: [],
      photoUrl: '',
      folder,
      createdAt: now(),
      updatedAt: now(),
      lastLoginAt: null,
    });
    await makeFolder(`${folder}/${FOLDER}`);
  }
  const changes = { clientId, status: 'active', serviceStart: client.serviceStart || formatDate(now(), 'yyyy-MM'), updatedAt: now() };
  await clientRef(client.id).update(changes);
  return { ...client, ...changes };
}

// ---------- Added or removed by AI Law ----------

// A new verified client record with its folder, for someone who isn't a
// client yet (same shape as accounts makes)
async function newClientRecord(name, idNumber, email, note) {
  const clientId = await newCode('ID', 'Clients');
  const words = name.split(/\s+/);
  const folder = `clients/verified/${clientId} - ${name}`;
  await db.doc('Clients/' + clientId).set({
    clientId,
    type: 'verified',
    status: 'active',
    role: 'client',
    firstName: words.length > 1 ? words[0] : name,
    lastName: words.length > 1 ? words.slice(1).join(' ') : '',
    displayName: name,
    email: email || '',
    emailVerified: false,
    phone: '',
    passport: '',
    idNumber: idNumber || '',
    address: '',
    notes: note,
    userId: '',
    providers: [],
    photoUrl: '',
    folder,
    createdAt: now(),
    updatedAt: now(),
    lastLoginAt: null,
  });
  return { id: clientId, folder, displayName: name };
}

// input: name, registrationId, clientId (an existing ID-… record, or empty
// for a new one), telegramId, email, serviceStart (yyyy-MM), deliveryMethod
export async function addClient(input) {
  const registrationId = cleanText(input.registrationId ?? '', 20).replace(/\s+/g, '');
  if (registrationId && !/^\d{9,11}$/.test(registrationId)) throw new ApiError('INVALID_REGISTRATION_ID');
  if (registrationId && (await findClient({ registrationId }))) throw new ApiError('ALREADY_ON_LIST');
  const telegramId = cleanText(input.telegramId ?? '', 20);
  if (telegramId && !/^-?\d+$/.test(telegramId)) throw new ApiError('INVALID_TELEGRAM_ID');
  const email = cleanText(input.email ?? '', 200).toLowerCase();
  const start = String(input.serviceStart || formatDate(now(), 'yyyy-MM'));
  checkMonth(start);
  const deliveryMethod = input.deliveryMethod === 'email' ? 'email' : 'telegram';

  let record;
  if (input.clientId) {
    const snap = await db.doc('Clients/' + cleanText(input.clientId, 20)).get();
    if (!snap.exists) throw new ApiError('CLIENT_NOT_FOUND');
    record = { id: snap.id, ...snap.data() };
    if (await findClient({ clientId: record.id })) throw new ApiError('ALREADY_ON_LIST');
  } else {
    const name = cleanText(input.name, 100, 'INVALID_NAME').replace(/\s+/g, ' ');
    if (name.length < 3) throw new ApiError('INVALID_NAME');
    record = await newClientRecord(name, registrationId, email, 'Added to 1% declarations by AI Law');
  }
  const name = cleanText(input.name || record.displayName || '', 100, 'INVALID_NAME').replace(/\s+/g, ' ');
  if (record.folder) await makeFolder(`${record.folder}/${FOLDER}`);

  const key = registrationId || record.id;
  const client = {
    name,
    registrationId,
    clientId: record.id,
    email: email || record.email || '',
    telegramId,
    telegramUsername: '',
    deliveryMethod,
    status: 'active',
    active: true,
    serviceStart: start,
    endedAt: null,
    outstandingDebt: 0,
    orderNumber: '',
    duplicateOf: '',
    createdAt: now(),
  };
  await clientRef(key).set(client);
  return { id: key, ...client };
}

// Off the list completely, with every month; the client record stays (it
// may have other orders). files: also the client's SmallBusinessDeclarations folder
export async function deleteClient(key, files) {
  const client = await findClient({ key });
  if (!client) throw new ApiError('CLIENT_NOT_FOUND');
  const monthsSnap = await clientRef(client.id).collection('Months').get();
  for (let i = 0; i < monthsSnap.docs.length; i += 400) {
    const batch = db.batch();
    monthsSnap.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
  const drafts = await TOOL.collection('Drafts').where('key', '==', client.id).get();
  for (const d of drafts.docs) await d.ref.delete();
  await clientRef(client.id).delete();
  if (files && client.clientId) {
    const record = (await db.doc('Clients/' + client.clientId).get()).data();
    if (record?.folder) await removeFolder(`${record.folder}/${FOLDER}`);
  }
  return { deleted: client.id, months: monthsSnap.size, files: !!files };
}

// ---------- Enrolling from an order ----------

// A signed-in client ordered the service: they go on the list at once,
// active, with no verification and no wait for payment. Ordering again
// after ending the service starts it again on the same record.
export async function enrol(order, client, details = {}) {
  const month = formatDate(now(), 'yyyy-MM');
  const registrationId = String(details.registrationId || '').replace(/\s+/g, '');
  const existing = await findClient({ clientId: client.id });
  // The same registration ID on another client's record is never joined
  // automatically: the new record is flagged for AI Law to sort out
  const other = registrationId && !existing ? await findClient({ registrationId }) : null;
  const duplicateOf = other && other.clientId !== client.id ? other.id : '';
  if (existing) {
    const changes = { status: 'active', endedAt: null, orderNumber: order.orderNumber, clientId: client.id, updatedAt: now() };
    if (registrationId && !existing.registrationId) changes.registrationId = registrationId;
    await clientRef(existing.id).update(changes);
    return { ...existing, ...changes };
  }
  const key = registrationId && !other && !(await clientRef(registrationId).get()).exists ? registrationId : client.id;
  const record = {
    name: order.customerName || client.displayName || '',
    registrationId,
    clientId: client.id,
    email: order.customerEmail || client.email || '',
    telegramId: '',
    telegramUsername: '',
    // A website client has an email, not (yet) a Telegram chat
    deliveryMethod: 'email',
    status: 'active',
    active: true,
    serviceStart: month,
    endedAt: null,
    outstandingDebt: 0,
    orderNumber: order.orderNumber,
    duplicateOf,
    createdAt: now(),
  };
  await clientRef(key).set(record);
  if (client.folder) await makeFolder(`${client.folder}/${FOLDER}`);
  return { id: key, ...record };
}
