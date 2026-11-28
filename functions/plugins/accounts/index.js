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
//   listUsers, setUserStatus   accounts (clients who signed up)
//   admin:clients              every client: users, verified and guests
//   admin:verifyClient         after the passport check: type → verified, with
//                              passport / ID number / address; a client
//                              without an account gets a permanent folder
//   admin:unverifyClient       back to user (with an account) or guest
//   admin:setClientNotes       AI Law's internal notes on a client (never
//                              shown to the client)
// Folders: clients/users/ID-… - Name or clients/verified/ID-… - Name; the
// folder moves between the two when the type changes.
//   admin:linkAccount          joins a login to an existing client (e.g. a
//                              verified client who signed up later): the
//                              existing record keeps its code and folder; the
//                              record the sign-up made is merged into it
// Nothing is joined automatically, not even on a matching email.
// ==========================================================

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { ApiError, cleanKey, cleanText, db, iso, newCode, now, titleCase } from '../../core/app.js';
import { makeFolder, moveFolder } from '../../core/files.js';
import { proposeAction } from '../../core/chat-actions.js';
import { clientById, clientByUid, docs } from '../../core/records.js';
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
    Providers: (Array.isArray(c.providers) ? c.providers : []).join(','),
    EmailVerified: c.emailVerified === true,
    PhotoURL: c.photoUrl || '',
    CreatedAt: iso(c.createdAt),
    UpdatedAt: iso(c.updatedAt),
    LastLoginAt: iso(c.lastLoginAt),
  };
}

// "clients/users/ID-7K3Q9X - Gocha Okreshidze": the client's own Storage
// folder, under users or verified by the client's type
export function clientFolder(clientId, name, type) {
  return `${clientGroup(type)}/${clientId}${name ? ' - ' + titleCase(name) : ''}`;
}

const clientGroup = (type) => (type === 'verified' ? 'clients/verified' : 'clients/users');

// ---------- Moving a client's folder ----------

// When a client's type changes (user ↔ verified) their folder moves to the
// matching group, with their order folders inside; every path stored on the
// client and their orders (folders, agreements, step results) moves with it
async function moveClientFolder(client, type) {
  const from = client.folder;
  if (!from || from.startsWith('drive:')) return from;
  // The folder keeps its name ("ID-… - Name"); only the group changes
  const target = clientGroup(type) + '/' + from.split('/').pop();
  if (from === target) return from;
  await moveFolder(from, target);
  const swap = (value) => rewritePaths(value, from, target);
  const orders = await db.collection('Orders').where('clientId', '==', client.id).get();
  for (const order of orders.docs) {
    await rewriteDoc(order.ref, swap);
    for (const sub of ['Items', 'Steps', 'Assignments']) {
      const inner = await order.ref.collection(sub).get();
      for (const d of inner.docs) await rewriteDoc(d.ref, swap);
    }
  }
  return target;
}

// Every text starting with the old folder (or "file:" + it) gets the new one;
// lists and plain objects are gone through, anything else is left as it is
function rewritePaths(value, from, to) {
  if (typeof value === 'string') {
    for (const head of ['', 'file:']) {
      const old = head + from;
      if (value === old || value.startsWith(old + '/')) return head + to + value.slice(old.length);
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => rewritePaths(v, from, to));
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewritePaths(v, from, to)]));
  }
  return value;
}

async function rewriteDoc(ref, swap) {
  const data = (await ref.get()).data() || {};
  const changes = {};
  for (const [key, value] of Object.entries(data)) {
    const next = swap(value);
    if (JSON.stringify(next) !== JSON.stringify(value)) changes[key] = next;
  }
  if (Object.keys(changes).length) await ref.update(changes);
}

async function syncProfile(caller, input) {
  const account = await getAuth().getUser(caller.uid);
  // A new login always gets its own record: joining it to an existing
  // client (same person, other record) is done by AI Law (admin:linkAccount)
  const client = await clientByUid(caller.uid);
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
    record.folder = await makeFolder(clientFolder(clientId, [record.firstName, record.lastName].join(' '), record.type));
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

async function allClients() {
  return docs(await db.collection('Clients').get())
    .filter((c) => c.status !== 'merged' && (c.status !== 'deleted' || c.type === 'verified'))
    .map(toProfile);
}

async function verifyClient(caller, data) {
  const client = await clientById(cleanKey(data.clientId));
  if (!client) throw new ApiError('CLIENT_NOT_FOUND');
  const changes = {
    type: 'verified',
    status: 'active',
    passport: cleanText(data.passport ?? client.passport, 40, 'INVALID_PROFILE_DATA'),
    idNumber: cleanText(data.idNumber ?? client.idNumber, 20, 'INVALID_PROFILE_DATA'),
    address: cleanText(data.address ?? client.address, 300, 'INVALID_PROFILE_DATA'),
    phone: cleanText(data.phone ?? client.phone, 30, 'INVALID_PROFILE_DATA'),
    updatedAt: now(),
  };
  if (!changes.passport && !changes.idNumber) throw new ApiError('PASSPORT_OR_ID_REQUIRED');
  // A verified client keeps one folder for all their orders, under verified
  if (!client.folder || client.folder.startsWith('drive:')) {
    changes.folder = await makeFolder(clientFolder(client.id, client.displayName, 'verified'));
  } else {
    changes.folder = await moveClientFolder(client, 'verified');
  }
  await db.doc('Clients/' + client.id).update(changes);
  return toProfile({ ...client, ...changes });
}

async function unverifyClient(caller, data) {
  const client = await clientById(cleanKey(data.clientId));
  if (!client) throw new ApiError('CLIENT_NOT_FOUND');
  const changes = { type: client.userId ? 'user' : 'guest', updatedAt: now() };
  // Back to a user: the folder returns to users. A client without an account
  // keeps the folder where it is (their documents stay legal records)
  if (changes.type === 'user') changes.folder = await moveClientFolder(client, 'user');
  await db.doc('Clients/' + client.id).update(changes);
  return toProfile({ ...client, ...changes });
}

// ---------- Internal notes ----------

async function setClientNotes(data) {
  const client = await clientById(cleanKey(data.clientId));
  if (!client) throw new ApiError('CLIENT_NOT_FOUND');
  const changes = { notes: cleanText(data.notes, 5000, 'INVALID_NOTES'), updatedAt: now() };
  await db.doc('Clients/' + client.id).update(changes);
  return toProfile({ ...client, ...changes });
}

// ---------- Joining a login to an existing client ----------

// target: the existing client (no login yet); the login's own record (made
// at sign-up) gives up its login, orders and files and is marked merged
async function linkAccount(data) {
  const target = await clientById(cleanKey(data.clientId));
  if (!target) throw new ApiError('CLIENT_NOT_FOUND');
  if (target.userId) throw new ApiError('ALREADY_LINKED');
  const source = await clientByUid(cleanKey(data.userId));
  if (!source) throw new ApiError('PROFILE_NOT_FOUND');
  if (source.id === target.id) throw new ApiError('INVALID_REQUEST');
  if (source.role !== 'client') throw new ApiError('PRIVILEGED_ACCOUNT');

  // The target needs a folder to take the source's files
  let folder = target.folder && !target.folder.startsWith('drive:') ? target.folder : '';
  if (!folder) folder = await makeFolder(clientFolder(target.id, target.displayName, target.type));

  // Orders and their files move to the target
  const from = source.folder && !source.folder.startsWith('drive:') ? source.folder : '';
  if (from) await moveFolder(from, folder);
  const swap = (value) => (from ? rewritePaths(value, from, folder) : value);
  const orders = await db.collection('Orders').where('clientId', '==', source.id).get();
  for (const order of orders.docs) {
    await rewriteDoc(order.ref, swap);
    await order.ref.update({ clientId: target.id });
    for (const sub of ['Items', 'Steps', 'Assignments']) {
      const inner = await order.ref.collection(sub).get();
      for (const d of inner.docs) await rewriteDoc(d.ref, swap);
    }
  }

  const changes = {
    userId: source.userId,
    type: target.type === 'verified' ? 'verified' : 'user',
    status: 'active',
    email: target.email || source.email || '',
    emailVerified: source.emailVerified === true,
    providers: source.providers || [],
    photoUrl: source.photoUrl || '',
    phone: target.phone || source.phone || '',
    folder,
    lastLoginAt: source.lastLoginAt || null,
    updatedAt: now(),
  };
  // The login leaves the source first, so it never belongs to two records
  await db.doc('Clients/' + source.id).update({ userId: '', status: 'merged', mergedInto: target.id, folder: '', updatedAt: now() });
  await db.doc('Clients/' + target.id).update(changes);
  return toProfile({ ...target, ...changes });
}

// ---------- Client chat tools ----------

const PROFILE_FIELDS = ['firstName', 'lastName', 'displayName', 'phone'];

const tools = {
  my_profile: {
    sides: ['client'],
    description: "The signed-in client's own details: name, email, phone, client code, whether they are verified.",
    parameters: { type: 'object', properties: {} },
    run: async (ctx) => {
      if (!ctx.caller.signedIn) return { error: 'SIGN_IN_REQUIRED' };
      const p = toProfile(await ownClient(ctx.caller));
      return { name: p.DisplayName, firstName: p.FirstName, lastName: p.LastName, email: p.Email, phone: p.Phone, clientCode: p.ClientID, type: p.Type };
    },
  },
  update_my_profile: {
    sides: ['client'],
    description:
      "Proposes changing the signed-in client's own name (firstName, lastName, displayName) or phone; the email is " +
      'changed in Profile → Settings. Shows a Confirm card; nothing changes until they confirm.',
    parameters: { type: 'object', properties: Object.fromEntries(PROFILE_FIELDS.map((f) => [f, { type: 'string' }])) },
    run: async (ctx, args) => {
      if (!ctx.caller.signedIn) return { error: 'SIGN_IN_REQUIRED' };
      const data = Object.fromEntries(PROFILE_FIELDS.filter((f) => typeof args?.[f] === 'string').map((f) => [f, args[f]]));
      if (!Object.keys(data).length) return { error: 'NOTHING_TO_CHANGE' };
      return proposeAction(ctx, {
        action: 'updateProfile',
        data,
        title: 'Change your details',
        lines: Object.entries(data).map(([k, v]) => `${k}: ${v || '(empty)'}`),
      });
    },
  },
};

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
      'admin:clients': () => allClients(),
      'admin:verifyClient': (caller, data) => verifyClient(caller, data),
      'admin:unverifyClient': (caller, data) => unverifyClient(caller, data),
      'admin:linkAccount': (caller, data) => linkAccount(data),
      'admin:setClientNotes': (caller, data) => setClientNotes(data),
    },
  },
  tools,
};
