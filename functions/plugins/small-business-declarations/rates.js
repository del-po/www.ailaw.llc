// ==========================================================
// Small business declarations: exchange rates
// Income received in USD, EUR or GBP counts in GEL at the National Bank of
// Georgia's rate for the day it was received; exchangerate.host is the
// fallback when the NBG doesn't answer.
// ==========================================================

export const CURRENCIES = ['GEL', 'USD', 'EUR', 'GBP'];

const NBG = 'https://nbg.gov.ge/gw/api/ct/monetarypolicy/currencies/en/json';
const FALLBACK = 'https://api.exchangerate.host';

async function nbgRate(currency, date) {
  try {
    const res = await fetch(`${NBG}/?date=${date}`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    for (const day of await res.json()) {
      const found = (day.currencies || []).find((c) => c.code === currency);
      // The NBG gives the rate for "quantity" units (e.g. 100 for some currencies)
      if (found) return Number(found.rate) / Number(found.quantity || 1);
    }
  } catch {
    // Falls through to the fallback
  }
  return null;
}

async function fallbackRate(currency, date) {
  try {
    const res = await fetch(`${FALLBACK}/${date}?base=${currency}&symbols=GEL`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const rate = (await res.json())?.rates?.GEL;
    return rate ? Number(rate) : null;
  } catch {
    return null;
  }
}

// GEL for one unit of currency on date (yyyy-MM-dd), or null
export async function gelRate(currency, date) {
  const code = String(currency || '').toUpperCase();
  if (code === 'GEL') return 1;
  if (!CURRENCIES.includes(code)) return null;
  return (await nbgRate(code, date)) ?? (await fallbackRate(code, date));
}
