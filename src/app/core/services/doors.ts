// The backend's three entrances (Firebase Functions, functions/doors/index.js).
// Each takes POST { action, idToken | guestId, data } and answers
// { ok, data } or { ok: false, error }; public reads also work as GET ?action=…
const BASE = 'https://europe-west1-website-ai-law.cloudfunctions.net';

export const DOORS = {
  // Website: chat, profile, checkout, orders, documents, services, blog
  client: `${BASE}/client`,
  // Joining as a lawyer, the Workspace
  lawyer: `${BASE}/lawyer`,
  // Admin pages
  admin: `${BASE}/admin`,
} as const;

export type DoorResult<T> = { ok: true; data: T } | { ok: false; error: string };
