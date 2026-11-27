// ==========================================================
// Core: the guard
//   - who is asking: a Firebase login, or a visitor's random browser id
//   - which side they may use: client, lawyer (staff) or admin
//   - the daily question limit
// Lawyers carry { staff: true, lawyerId } on their Firebase login, set when
// their application is approved.
// ==========================================================

import { getAuth } from 'firebase-admin/auth';
import { ApiError, FieldValue, db, today } from './app.js';
import { clientByUid } from './records.js';

export async function identify(idToken, guestId) {
  if (idToken) {
    let account;
    try {
      account = await getAuth().verifyIdToken(idToken);
    } catch {
      throw new ApiError('AUTH_REQUIRED');
    }
    const client = await clientByUid(account.uid);
    const status = String(client?.status || 'active').toLowerCase();
    if (status === 'suspended') throw new ApiError('ACCOUNT_SUSPENDED');

    return {
      ownerId: account.uid,
      uid: account.uid,
      email: account.email || '',
      emailVerified: account.email_verified === true,
      name: client?.displayName || account.name || '',
      client,
      isAdmin: !!client && client.role === 'admin' && status === 'active',
      isStaff: account.staff === true,
      lawyerId: account.lawyerId || '',
      signedIn: true,
      authTime: Number(account.auth_time) || 0,
    };
  }

  if (guestId && /^[a-zA-Z0-9-]{8,64}$/.test(guestId)) {
    return { ownerId: 'guest:' + guestId, signedIn: false, isAdmin: false, isStaff: false };
  }

  throw new ApiError('AUTH_REQUIRED');
}

// The side a caller may use: an admin and a lawyer can also use the client side
export function allowed(caller, side) {
  if (side === 'client') return true;
  if (side === 'lawyer') return caller.isStaff && !!caller.lawyerId;
  if (side === 'admin') return caller.isAdmin;
  return false;
}

export function requireSignIn(caller) {
  if (!caller.signedIn) throw new ApiError('AUTH_REQUIRED');
  return caller;
}

// Daily questions per person (Settings → chat); admins are not counted
export async function countQuestion(caller, settings) {
  if (caller.isAdmin) return;
  const limit = Number(
    caller.signedIn ? settings.UserQuestionsPerDay || 30 : settings.GuestQuestionsPerDay || 5,
  );
  const ref = db.doc(`Usage/${caller.ownerId.replace(/[/:]/g, '_')}_${today()}`);
  await db.runTransaction(async (t) => {
    const count = Number((await t.get(ref)).data()?.count || 0);
    if (count >= limit) throw new ApiError(caller.signedIn ? 'LIMIT_REACHED' : 'GUEST_LIMIT_REACHED');
    t.set(ref, { ownerId: caller.ownerId, date: today(), count: FieldValue.increment(1) }, { merge: true });
  });
}
