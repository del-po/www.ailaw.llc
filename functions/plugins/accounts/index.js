// ==========================================================
// Plugin: accounts (client + admin)
// Client:
//   syncProfile         after every sign-in: creates or refreshes the client
//                       record, its ID-XXXXXX code and its Storage folder
//   getProfile, updateProfile
//   prepareAccountDeletion → (the browser deletes the Firebase login) →
//   finalizeAccountDeletion   removes the client's account link; orders and
//                             documents stay, as legal records
// Admin:
//   listUsers, setUserStatus
// A guest or verified client who signs up with a confirmed email matching
// their record becomes a user and keeps their code and folder.
// ==========================================================

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { ApiError, cleanText, db, iso, newCode, now, titleCase } from '../../core/app.js';
import { makeFolder } from '../../core/files.js';
import { clientByEmail, clientByUid } from '../../core/records.js';
import { getAuth } from 'firebase-admin/auth';

const DELETE_TICKET_MINUTES = 20;
const MAX_LOGIN_AGE_SECONDS = 5 * 60;

// The website's Profile shape
function toProfile(c) {
  return {
    ClientID: c.id,
    FolderID: c.folder || '',
    Type: c.type,
    Status: c.status,
    FirstName: c.firstName || '',
    LastName: c.lastName || '',
    DisplayName: c.displayName || '',
    Email: c.email || '',
    Phone: c.phone || '',
    Passport: c.passport || '',
    IDNumber: c.idNumber || '',
    Address: c.address || '',
    Notes: c.notes || '',
    UserID: c.userId || '',
    Role: c.role || 'client',
    Providers: (c.providers || []).join(','),
    EmailVerified: c.emailVerified === true,
    PhotoURL: c.photoUrl || '',
    CreatedAt: iso(c.createdAt),
    UpdatedAt: iso(c.updatedAt),
    LastLoginAt: iso(c.lastLoginAt),
  };
}

// "ID-7K3Q9X - Gocha Okreshidze": the client's own Storage folder
export function clientFolder(clientId, name) {
  return `clients/${clientId}${name ? ' - ' + titleCase(name) : ''}`;
}

async function syncProfile(caller, input) {
  const account = await getAuth().getUser(caller.uid);
  let client = await clientByUid(caller.uid);
  if (!client && account.emailVerified && account.email) {
    const known = await clientByEmail(account.email);
    // A deleted account's record comes back to life on a new sign-up
    if (known && !known.userId) client = { ...known, status: known.status === 'deleted' ? 'active' : known.status };
  }
  if (client && client.status && client.status !== 'active') throw new ApiError('ACCOUNT_SUSPENDED');

  const name = cleanText(client?.displayName || input.displayName || account.displayName || '', 100, 'INVALID_PROFILE_DATA');
  const words = name.split(/\s+/).filter(Boolean);
  const record = client
    ? { ...client }
    : {
        firstName: cleanText(input.firstName ?? words[0] ?? '', 80, 'INVALID_PROFILE_DATA'),
        lastName: cleanText(input.lastName ?? words.slice(1).join(' '), 80, 'INVALID_PROFILE_DATA'),
        displayName: name,
        phone: '',
        passport: '',
        idNumber: '',
        address: '',
        notes: '',
        role: 'client',
        status: 'active',
        createdAt: new Date(account.metadata.creationTime || Date.now()),
      };
  if (!record.displayName) record.displayName = [record.firstName, record.lastName].join(' ').trim();

  record.userId = caller.uid;
  if (record.type !== 'verified') record.type = 'user';
  record.role ||= 'client';
  record.status ||= 'active';
  record.email = String(account.email || '').toLowerCase();
  record.providers = account.providerData.map((p) => p.providerId);
  record.emailVerified = account.emailVerified === true;
  record.photoUrl = account.photoURL || '';
  record.updatedAt = now();
  record.lastLoginAt = new Date(account.metadata.lastSignInTime || Date.now());

  const clientId = client?.id || (await newCode('ID', 'Clients'));
  // Records copied from Drive point to a Drive folder: they get a Storage one
  if (!record.folder || record.folder.startsWith('drive:')) {
    record.folder = await makeFolder(clientFolder(clientId, [record.firstName, record.lastName].join(' ')));
  }
  delete record.id;
  record.clientId = clientId;
  await db.doc('Clients/' + clientId).set(record);
  return toProfile({ id: clientId, ...record });
}

async function ownClient(caller) {
  const client = await clientByUid(caller.uid);
  if (!client) throw new ApiError('PROFILE_NOT_FOUND');
  if (client.status !== 'active') throw new ApiError('ACCOUNT_SUSPENDED');
  return client;
}

async function updateProfile(caller, input) {
  const client = await ownClient(caller);
  const changes = { updatedAt: now() };
  const fields = { firstName: 100, lastName: 100, displayName: 100, phone: 30 };
  for (const [key, max] of Object.entries(fields)) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      if (typeof input[key] !== 'string') throw new ApiError('INVALID_PROFILE_DATA');
      changes[key] = cleanText(input[key], max, 'INVALID_PROFILE_DATA');
    }
  }
  await db.doc('Clients/' + client.id).update(changes);
  return toProfile({ ...client, ...changes });
}

// ---------- Account deletion ----------

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

async function prepareAccountDeletion(caller) {
  const age = Math.floor(Date.now() / 1000) - caller.authTime;
  if (!caller.authTime || age > MAX_LOGIN_AGE_SECONDS || age < -60) throw new ApiError('RECENT_LOGIN_REQUIRED');
  const client = await clientByUid(caller.uid);
  if (client && ['admin', 'staff'].includes(client.role)) throw new ApiError('PRIVILEGED_ACCOUNT_DELETE_REQUIRES_REVIEW');

  const secret = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + DELETE_TICKET_MINUTES * 60 * 1000);
  await db.doc('Tickets/delete_' + caller.uid).set({ hash: sha256(secret), expiresAt, done: false });
  return { userId: caller.uid, secret, expiresAt: expiresAt.toISOString() };
}

// Called after the Firebase login is gone, so it carries a one-time ticket
// instead of a login
async function finalizeAccountDeletion(_, data, env, body) {
  const ticket = body.ticket || data.ticket || data;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(ticket?.userId || '') || !/^[0-9a-f]{64}$/.test(ticket?.secret || '')) {
    throw new ApiError('INVALID_DELETION_TICKET');
  }
  const ref = db.doc('Tickets/delete_' + ticket.userId);
  const stored = (await ref.get()).data();
  if (!stored) throw new ApiError('INVALID_DELETION_TICKET');
  if (Date.now() > stored.expiresAt.toDate().getTime()) {
    await ref.delete();
    throw new ApiError('EXPIRED_DELETION_TICKET');
  }
  const a = Buffer.from(sha256(ticket.secret));
  const b = Buffer.from(stored.hash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ApiError('INVALID_DELETION_TICKET');
  if (stored.done) return { deleted: true, profileDeleted: true };

  // The client record stays (orders and agreements point to it); only the
  // account link and login details go
  const client = await clientByUid(ticket.userId);
  if (client) {
    await db.doc('Clients/' + client.id).update({
      userId: '',
      type: client.type === 'verified' ? 'verified' : 'guest',
      status: 'deleted',
      providers: [],
      emailVerified: false,
      photoUrl: '',
      updatedAt: now(),
    });
  }
  await ref.update({ done: true });
  return { deleted: true, profileDeleted: true };
}

// ---------- Admin ----------

async function listUsers() {
  const snap = await db.collection('Clients').where('userId', '>', '').get();
  return snap.docs.map((d) => toProfile({ id: d.id, ...d.data() }));
}

async function setUserStatus(caller, data) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(data.userId || '') || !['active', 'suspended'].includes(data.status)) {
    throw new ApiError('INVALID_REQUEST');
  }
  if (data.userId === caller.uid) throw new ApiError('CANNOT_CHANGE_OWN_ACCOUNT');
  const client = await clientByUid(data.userId);
  if (!client) throw new ApiError('PROFILE_NOT_FOUND');
  if (client.role !== 'client') throw new ApiError('PRIVILEGED_ACCOUNT');
  await db.doc('Clients/' + client.id).update({ status: data.status, updatedAt: now() });
  return toProfile({ ...client, status: data.status });
}

export default {
  id: 'accounts',
  sides: ['client', 'admin'],
  actions: {
    client: {
      syncProfile: (caller, data) => syncProfile(caller, data),
      getProfile: async (caller) => toProfile(await ownClient(caller)),
      updateProfile: (caller, data) => updateProfile(caller, data),
      prepareAccountDeletion: (caller) => prepareAccountDeletion(caller),
      finalizeAccountDeletion: { public: true, run: finalizeAccountDeletion },
    },
    admin: {
      listUsers: () => listUsers(),
      setUserStatus: (caller, data) => setUserStatus(caller, data),
    },
  },
};
