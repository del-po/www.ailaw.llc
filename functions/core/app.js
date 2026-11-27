// ==========================================================
// Core: shared setup and small helpers
//   - Firestore (database "ailaw") and Storage (the default bucket)
//   - ApiError: an error code the website shows or translates
//   - ids, dates, text checks used everywhere
// ==========================================================

import { randomUUID } from 'node:crypto';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

if (!getApps().length) initializeApp();

export const db = getFirestore('ailaw');
export const bucket = () => getStorage().bucket();
export { FieldValue, Timestamp };

export const TIME_ZONE = 'Asia/Tbilisi';
export const SITE = 'https://www.ailaw.llc';

// The company, as it appears on agreements, invoices and emails
export const COMPANY = Object.freeze({
  name: 'AI Law LLC',
  registration: '405408401',
  address: 'Chavchavadze Ave. 83, Tbilisi, 0162 GEO',
  phone: '(+995) 591-893-893',
  email: 'info@ailaw.llc',
  website: 'www.ailaw.llc',
  signatory: 'Gocha Okreshidze',
  // Who clients contact to get verified
  verifyContact: 'our lawyer Gocha Okreshidze (info@ailaw.llc, (+995) 591-893-893)',
});

export class ApiError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

// ---------- Ids ----------

export const uuid = () => randomUUID();

// ID-7K3Q9X, LW-7K3Q9X: letters and digits that are easy to confuse (0/O, 1/I/L) are left out
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// A code not yet used as a document id in the collection
export async function newCode(prefix, collection) {
  for (;;) {
    let code = prefix + '-';
    for (let i = 0; i < 6; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!(await db.collection(collection).doc(code).get()).exists) return code;
  }
}

// ---------- Dates ----------

export const now = () => new Date();

// Firestore Timestamp, Date or text → Date (or null)
export function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// → ISO text for the website, '' when empty
export const iso = (value) => toDate(value)?.toISOString() || '';

// → "2026-11-24", or another layout in Tbilisi time
export function formatDate(value, layout = 'yyyy-MM-dd') {
  const date = toDate(value) || new Date();
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return layout
    .replace('yyyy', parts.year)
    .replace('MM', parts.month)
    .replace('dd', parts.day)
    .replace('HH', parts.hour === '24' ? '00' : parts.hour)
    .replace('mm', parts.minute)
    .replace('ss', parts.second);
}

export const today = () => formatDate(new Date());

// ---------- Text ----------

export function parseJson(text, fallback) {
  if (!text) return fallback;
  if (typeof text === 'object') return text;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

// Trimmed text with a length limit; no control characters
export function cleanText(value, max, code = 'INVALID_TEXT') {
  const text = String(value ?? '').trim();
  if (text.length > max || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text)) {
    throw new ApiError(code);
  }
  return text;
}

// Letters, digits, - and _ only (ids from the website)
export function cleanKey(value, code = 'INVALID_ID') {
  const text = String(value ?? '').trim();
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(text)) throw new ApiError(code);
  return text;
}

export const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());

// "gocha OKRESHIDZE" → "Gocha Okreshidze"; drops characters file names can't hold
export function titleCase(text) {
  return cleanName(text)
    .toLowerCase()
    .replace(/(^|[\s-])(\S)/g, (match, space, letter) =>
      space + (/[Ⴀ-ჿᲐ-Ჿ]/.test(letter) ? letter : letter.toUpperCase()),
    );
}

export function cleanName(value) {
  return String(value || '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/%/g, '-percent-')
    .replace(/&/g, '-and-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const money = (value) => (Math.round(Number(value || 0) * 100) / 100).toFixed(2);

// ---------- Logs ----------

// Failed jobs and requests, so problems show up in Firestore → Logs
export async function log(action, error, details = '') {
  try {
    await db.collection('Logs').add({
      time: now(),
      action: String(action || ''),
      error: String(error?.code || error?.message || error || ''),
      details: String(details || error?.stack || '').slice(0, 2000),
    });
  } catch (err) {
    console.error('Log failed', err);
  }
}
