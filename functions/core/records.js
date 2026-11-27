// ==========================================================
// Core: records (live business data in Firestore)
//   Clients/{ID-XXXXXX}     one per client: user, verified or guest
//   Staff/{LW-XXXXXX}       one per lawyer
//   Services/{slug}         the catalogue
//   Orders/{AIL-…}          + Items, Steps, Assignments inside each order
//   Chat/{id}               + Messages
//   Settings/{name}         chat, categories, and one record per door
// Reads that change rarely (settings, services) are kept for a minute.
// ==========================================================

import { ApiError, db, toDate, today } from './app.js';

const cache = new Map();

// The value of build(), kept for `seconds`
export async function cached(key, seconds, build) {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  const value = await build();
  cache.set(key, { value, until: Date.now() + seconds * 1000 });
  return value;
}

export const forget = (key) => cache.delete(key);

const data = (snap) => (snap.exists ? { id: snap.id, ...snap.data() } : null);
const all = (snap) => snap.docs.filter((d) => d.id !== '_template').map((d) => ({ id: d.id, ...d.data() }));

export { all as docs, data as doc };

// ---------- Settings ----------

export async function setting(name) {
  return cached('setting:' + name, 60, async () => data(await db.doc('Settings/' + name).get()) || {});
}

// Settings → chat: provider, model, limits, bank details
export async function chatSettings() {
  return (await setting('chat')).values || {};
}

// ---------- Clients ----------

export async function clientByUid(uid) {
  if (!uid) return null;
  const snap = await db.collection('Clients').where('userId', '==', uid).limit(1).get();
  return snap.empty ? null : data(snap.docs[0]);
}

export async function clientById(clientId) {
  return clientId ? data(await db.doc('Clients/' + clientId).get()) : null;
}

// A guest or verified client without an account, found by email
export async function clientByEmail(email) {
  const wanted = String(email || '').trim().toLowerCase();
  if (!wanted) return null;
  const snap = await db.collection('Clients').where('email', '==', wanted).get();
  return all(snap)[0] || null;
}

// guest 0 (no account), user 1 (account), verified 2 (passport checked)
export const LEVELS = Object.freeze({ guest: 0, user: 1, verified: 2 });

export function clientLevel(client) {
  if (!client) return 0;
  if (client.type === 'verified') return 2;
  return client.userId ? 1 : 0;
}

// ---------- Lawyers ----------

export async function lawyerById(lawyerId) {
  return lawyerId ? data(await db.doc('Staff/' + lawyerId).get()) : null;
}

// ---------- Services ----------

// Every service, kept for a minute; the price check uses the live record
export async function services() {
  return cached('services', 60, async () => all(await db.collection('Services').get()));
}

export async function serviceBySlug(slug) {
  return (await services()).find((s) => s.serviceId === slug) || null;
}

// Price today: the discount applies between discountStart and discountEnd (inclusive)
export function priceOf(service) {
  const price = Number(service.price) || 0;
  const discounted = Number(service.discountedPrice) || 0;
  const start = toDate(service.discountStart);
  const end = toDate(service.discountEnd);
  const day = today();
  const onSale =
    discounted > 0 &&
    discounted < price &&
    (!start || day >= start.toISOString().slice(0, 10)) &&
    (!end || day <= end.toISOString().slice(0, 10));
  return { price, finalPrice: onSale ? discounted : price, onSale };
}

// ---------- Orders ----------

export async function orderByNumber(orderNumber) {
  return orderNumber ? data(await db.doc('Orders/' + orderNumber).get()) : null;
}

// Orders also have a uuid (orderId), which the website uses in links
export async function orderById(orderId) {
  const snap = await db.collection('Orders').where('orderId', '==', String(orderId)).limit(1).get();
  return snap.empty ? null : data(snap.docs[0]);
}

export async function orderSteps(orderNumber) {
  const snap = await db.collection(`Orders/${orderNumber}/Steps`).orderBy('stepNo').get();
  return all(snap);
}

export async function orderItems(orderNumber) {
  return all(await db.collection(`Orders/${orderNumber}/Items`).get());
}

export async function requireOrder(orderNumber) {
  const order = await orderByNumber(orderNumber);
  if (!order) throw new ApiError('ORDER_NOT_FOUND');
  return order;
}
