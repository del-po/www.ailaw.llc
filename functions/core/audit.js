// ==========================================================
// Core: the audit log
// Every admin action that changes something is recorded in AuditLog/{id},
// whether it came from a button in the Admin Panel or from a Confirm card
// in the admin chat: both run through the admin door's one action table,
// and the door wraps that table with audited() (core/door.js).
// AuditLog/{id}:
//   time, uid, email, name         who
//   via                            panel | chat (+ chatActionId)
//   action                         the door action, e.g. admin:verifyClient
//   target                         { kind, id }: the record it was about
//   data                           what was sent (file contents left out)
//   changes                        { field: { from, to } } for the target
//                                  record, where it can be read before and after
//   ok, error                      how it ended
// Reads (lists, details, counts) and the admin's own chat list are not recorded.
// ==========================================================

import { db, log, now } from './app.js';
import { clientByUid, orderById } from './records.js';

const audit = () => db.collection('AuditLog');

// Reads by name: "…:list", "…:get", "adminListOrders" and the like
const READ =
  /(^|:)(list|get|counts|tasks|clients|lawyers|my|dashboard|audit|logs|status)$|^adminList|^adminGet|^listUsers$/i;

function isRead(action, data) {
  // The admin's own conversations (renaming, deleting) aren't platform changes
  if (action.startsWith('chat:')) return true;
  if (READ.test(action)) return true;
  // Called with nothing, it only reads the settings
  if (action === 'declarations:settings') return !Object.keys(data || {}).length;
  return false;
}

// Fields that change on every write and say nothing by themselves
const NOISE = new Set(['updatedAt', 'lastLoginAt']);

// ---------- The record an action is about ----------

// → { kind, id, ref } or null; ref is read before and after the action
async function targetOf(action, data = {}) {
  try {
    if (data.clientId) return { kind: 'client', id: data.clientId, ref: db.doc('Clients/' + data.clientId) };
    if (data.userId) {
      const client = await clientByUid(String(data.userId));
      return client
        ? { kind: 'client', id: client.id, ref: db.doc('Clients/' + client.id) }
        : { kind: 'account', id: data.userId, ref: null };
    }
    if (data.orderNumber) return { kind: 'order', id: data.orderNumber, ref: db.doc('Orders/' + data.orderNumber) };
    if (/^AIL-/i.test(String(data.orderId || ''))) {
      return { kind: 'order', id: data.orderId, ref: db.doc('Orders/' + data.orderId) };
    }
    if (data.orderId) {
      const order = await orderById(String(data.orderId));
      return order
        ? { kind: 'order', id: order.orderNumber, ref: db.doc('Orders/' + order.orderNumber) }
        : { kind: 'order', id: data.orderId, ref: null };
    }
    if (data.lawyerId) return { kind: 'lawyer', id: data.lawyerId, ref: db.doc('Staff/' + data.lawyerId) };
    if (action.startsWith('blog:') && data.slug) return { kind: 'article', id: data.slug, ref: null };
    if (action.startsWith('services:') && data.id != null) return { kind: 'service', id: String(data.id), ref: null };
    if (action.startsWith('categories:') && data.id != null) return { kind: 'category', id: String(data.id), ref: null };
    if (action.startsWith('declarations:') && data.key) return { kind: 'declarations client', id: data.key, ref: null };
  } catch {
    // An odd id: the action itself will refuse it
  }
  return null;
}

async function read(ref) {
  if (!ref) return null;
  try {
    const snap = await ref.get();
    return snap.exists ? snap.data() : null;
  } catch {
    return null;
  }
}

// Plain, comparable values: dates as ISO text, Timestamps too
function plain(value) {
  if (value == null) return value ?? null;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return JSON.parse(JSON.stringify(value));
}

function diff(before, after) {
  if (!before && !after) return null;
  const changes = {};
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const key of keys) {
    if (NOISE.has(key)) continue;
    const from = plain(before?.[key]);
    const to = plain(after?.[key]);
    if (JSON.stringify(from) !== JSON.stringify(to)) changes[key] = { from: from ?? null, to: to ?? null };
  }
  return Object.keys(changes).length ? changes : null;
}

// What was sent, without file contents (uploads are base64) and kept short
function sent(data) {
  const strip = (value, depth = 0) => {
    if (depth > 4) return '…';
    if (Array.isArray(value)) return value.slice(0, 50).map((v) => strip(v, depth + 1));
    if (value && typeof value === 'object') {
      if (typeof value.data === 'string' && value.data.length > 200) {
        return { file: value.name || 'file', size: value.data.length };
      }
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, strip(v, depth + 1)]));
    }
    if (typeof value === 'string' && value.length > 1000) return value.slice(0, 1000) + '…';
    return value;
  };
  return strip(data || {});
}

// ---------- The wrapper ----------

// routes: a door's action table → the same table, with every change recorded.
// A Confirm card runs the action with meta { via: 'chat', chatActionId }
// (core/chat-actions.js); anything else came from the panel.
export function audited(routes) {
  const wrapped = {};
  for (const [action, route] of Object.entries(routes)) {
    const run = typeof route === 'function' ? route : route.run;
    const recorded = async (caller, data, env, body, meta = {}) => {
      if (isRead(action, data)) return run(caller, data, env, body);
      const target = await targetOf(action, data || {});
      const before = await read(target?.ref);
      const entry = {
        time: now(),
        uid: caller?.uid || '',
        email: caller?.email || '',
        name: caller?.name || '',
        via: meta.via === 'chat' ? 'chat' : 'panel',
        chatActionId: meta.chatActionId || '',
        action,
        target: target ? { kind: target.kind, id: String(target.id) } : null,
        data: sent(data),
      };
      try {
        const result = await run(caller, data, env, body);
        await write({ ...entry, ok: true, error: '', changes: diff(before, await read(target?.ref)) });
        return result;
      } catch (err) {
        await write({ ...entry, ok: false, error: err.code || 'SERVER_ERROR', changes: null });
        throw err;
      }
    };
    wrapped[action] = typeof route === 'function' ? recorded : { ...route, run: recorded };
  }
  return wrapped;
}

// A missed audit line must not undo the action itself
async function write(entry) {
  try {
    await audit().add(entry);
  } catch (err) {
    await log('audit ' + entry.action, err);
  }
}
