// ==========================================================
// Google Sheets access for the chat (Sheets REST API)
// The function's service account must be an Editor of both spreadsheets.
// ==========================================================

import { GoogleAuth } from 'google-auth-library';

export const CHAT_SHEET_ID = '1C5J_gItxVL2qIVUo6t5neNuxPFQxM567Al2atn5fhKY';
export const USERS_SHEET_ID = '1SOf6nGb1VEBMCn5b9QwqPAcwoDklqN6NrS3pPamfblU';

const BASE = 'https://sheets.googleapis.com/v4/spreadsheets/';
const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets'] });

async function api(url, method = 'GET', data) {
  const client = await auth.getClient();
  const res = await client.request({ url, method, data });
  return res.data;
}

// Rows as objects keyed by the header row; _row is the sheet row number
function toTable(values = []) {
  const [headers = [], ...rows] = values;
  return {
    headers,
    rows: rows.map((r, i) => {
      const row = { _row: i + 2 };
      headers.forEach((h, j) => {
        row[h] = r[j] === undefined ? '' : r[j];
      });
      return row;
    }),
  };
}

// Several tabs in one request. Raw values: numbers stay numbers, TRUE stays true.
export async function readTabs(sheetId, tabs) {
  const ranges = tabs.map((t) => 'ranges=' + encodeURIComponent(t)).join('&');
  const data = await api(
    `${BASE}${sheetId}/values:batchGet?${ranges}&valueRenderOption=UNFORMATTED_VALUE`,
  );
  const out = {};
  data.valueRanges.forEach((vr, i) => {
    out[tabs[i]] = toTable(vr.values);
    headerCache.set(sheetId + '|' + tabs[i], out[tabs[i]].headers);
  });
  return out;
}

export async function readTab(sheetId, tab) {
  return (await readTabs(sheetId, [tab]))[tab];
}

// ---------- Short-lived cache for data that rarely changes ----------

const cache = new Map();

export async function cached(key, seconds, load) {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  const value = await load();
  cache.set(key, { value, until: Date.now() + seconds * 1000 });
  return value;
}

// ---------- Writing ----------

const headerCache = new Map();

async function headersOf(sheetId, tab) {
  const key = sheetId + '|' + tab;
  if (!headerCache.has(key)) {
    const data = await api(
      `${BASE}${sheetId}/values/${encodeURIComponent(tab + '!1:1')}?valueRenderOption=UNFORMATTED_VALUE`,
    );
    headerCache.set(key, (data.values && data.values[0]) || []);
  }
  return headerCache.get(key);
}

// RAW input: text is stored as typed, never turned into a formula, number or date
export async function appendRow(sheetId, tab, obj) {
  const headers = await headersOf(sheetId, tab);
  const row = headers.map((h) => (obj[h] === undefined || obj[h] === null ? '' : obj[h]));
  await api(
    `${BASE}${sheetId}/values/${encodeURIComponent(tab + '!A1')}:append` +
      '?valueInputOption=RAW&insertDataOption=INSERT_ROWS',
    'POST',
    { values: [row] },
  );
}

export async function updateRow(sheetId, tab, rowNumber, changes) {
  const headers = await headersOf(sheetId, tab);
  const data = Object.keys(changes)
    .filter((h) => headers.includes(h))
    .map((h) => ({
      range: `${tab}!${column(headers.indexOf(h))}${rowNumber}`,
      values: [[changes[h] === undefined || changes[h] === null ? '' : changes[h]]],
    }));
  if (!data.length) return;
  await api(`${BASE}${sheetId}/values:batchUpdate`, 'POST', { valueInputOption: 'RAW', data });
}

// 0 → A, 25 → Z, 26 → AA
function column(index) {
  let s = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  }
  return s;
}
