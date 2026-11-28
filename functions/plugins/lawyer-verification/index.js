// ==========================================================
// Plugin: lawyer verification (lawyer + admin)
// Lawyer (public):  apply — the "Join as a lawyer" form. Each application
//                   gets a code (LW-XXXXXX), a private Storage folder with
//                   the uploaded documents, and a Staff record "applied".
// Admin:            admin:lawyers, admin:approveLawyer, admin:rejectLawyer.
//                   Approving creates (or reuses) the lawyer's login, marks
//                   it { staff: true, lawyerId } and emails a password link.
// Statuses: applied → approved → active (first Workspace visit); left, suspended
// ==========================================================

import { getAuth } from 'firebase-admin/auth';
import { ApiError, COMPANY, cleanText, db, iso, newCode, now } from '../../core/app.js';
import { join, makeFolder, saveFile } from '../../core/files.js';
import { docs, lawyerById } from '../../core/records.js';
import { mail } from '../../core/steps.js';

const BUCKET_CONSOLE = 'https://console.firebase.google.com/project/website-ai-law/storage/website-ai-law.firebasestorage.app/files/~2F';
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const FILE_TYPES = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' };
const FILES = [
  { key: 'idDocument', title: 'ID document', required: true },
  { key: 'barLicense', title: 'Bar license', required: true },
  { key: 'cv', title: 'CV', required: false },
  { key: 'photo', title: 'Photo', required: false },
];

// ---------- Applying ----------

const list = (text) => String(text || '').split(',').map((x) => x.trim()).filter(Boolean);

function name(value) {
  const v = cleanText(value, 80);
  if (!v) throw new ApiError('MISSING_FIELDS');
  if (!/^[A-Za-z][A-Za-z '.\-]*$/.test(v)) throw new ApiError('INVALID_NAME');
  return v;
}

function required(value, max) {
  const v = cleanText(value, max);
  if (!v) throw new ApiError('MISSING_FIELDS');
  return v;
}

function upload(file, spec) {
  if (!file || !file.data) {
    if (spec.required) throw new ApiError('MISSING_FILES');
    return null;
  }
  const type = String(file.type || '').toLowerCase();
  if (!FILE_TYPES[type]) throw new ApiError('INVALID_FILE_TYPE');
  const content = Buffer.from(String(file.data), 'base64');
  if (!content.length) throw new ApiError('INVALID_FILE');
  if (content.length > MAX_FILE_BYTES) throw new ApiError('FILE_TOO_LARGE');
  return { spec, type, content };
}

async function apply(_, data, env) {
  // Bots fill every field; people never see this one
  if (data.website) return { received: true };
  if (data.consentData !== true || data.consentTruth !== true) throw new ApiError('CONSENT_REQUIRED');

  const email = required(data.email, 200).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError('INVALID_EMAIL');
  const iban = required(data.iban, 40).replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) throw new ApiError('INVALID_IBAN');
  const a = {
    firstName: name(data.firstName),
    lastName: name(data.lastName),
    email,
    phone: required(data.phone, 30),
    personalId: required(data.personalId, 20),
    address: required(data.address, 300),
    barLicenseNumber: required(data.barLicenseNumber, 50),
    licensedSince: required(data.licensedSince, 20),
    specializations: list(cleanText(data.specializations, 500)),
    languages: list(cleanText(data.languages, 200)),
    bio: cleanText(data.bio, 2000),
    iban,
  };
  const files = FILES.map((f) => upload(data.files?.[f.key], f)).filter(Boolean);

  // One open application per email
  const open = docs(await db.collection('Staff').where('email', '==', email).get())
    .some((s) => ['applied', 'approved', 'active'].includes(s.status));
  if (open) throw new ApiError('ALREADY_APPLIED');

  const lawyerId = await newCode('LW', 'Staff');
  const fullName = `${a.firstName} ${a.lastName}`;
  const folder = await makeFolder(`staff/${lawyerId} - ${fullName}`);
  for (const f of files) {
    await saveFile(join(folder, `${f.spec.title} - ${fullName}${FILE_TYPES[f.type]}`), f.content, f.type);
  }
  const record = {
    ...a,
    lawyerId,
    status: 'applied',
    userId: '',
    services: [],
    maxOpenAssignments: 0,
    availability: '',
    photoUrl: '',
    folder,
    agreementSignedAt: null,
    appliedAt: now(),
    verifiedAt: null,
    updatedAt: now(),
    notes: '',
  };
  await db.doc('Staff/' + lawyerId).set(record);

  await mail(env, {
    to: email,
    subject: `Your application to AI Law (${lawyerId})`,
    text: [
      `Dear ${a.firstName},`,
      '',
      `Thank you for applying to work with AI Law. We have received your application (${lawyerId}) and your documents.`,
      '',
      'We review every application ourselves. If your application is approved, we will call you to arrange an interview.',
      '',
      'AI Law LLC · www.ailaw.llc',
    ].join('\n'),
  });
  await mail(env, {
    to: COMPANY.applicationsEmail,
    subject: `New lawyer application — ${fullName}`,
    text: [
      `New lawyer application: ${fullName} (${lawyerId})`,
      '',
      `Email: ${email}`,
      `Phone: ${a.phone}`,
      `Bar license: ${a.barLicenseNumber}, since ${a.licensedSince}`,
      `Specializations: ${a.specializations.join(', ') || '—'}`,
      '',
      `Documents: ${BUCKET_CONSOLE}${encodeURIComponent(folder).replace(/%2F/g, '~2F')}`,
      'Review it on www.ailaw.llc/admin/lawyers',
    ].join('\n'),
  });
  return { received: true, lawyerId };
}

// ---------- Admin ----------

// The documents open in the Firebase console, which only the owner can see
function toAdminLawyer(s) {
  return {
    lawyerId: s.lawyerId || s.id,
    status: s.status,
    firstName: s.firstName,
    lastName: s.lastName,
    email: s.email,
    phone: String(s.phone || ''),
    barLicenseNumber: String(s.barLicenseNumber || ''),
    licensedSince: s.licensedSince instanceof Object ? iso(s.licensedSince).slice(0, 10) : String(s.licensedSince || ''),
    specializations: (s.specializations || []).join(', '),
    languages: (s.languages || []).join(', '),
    bio: s.bio || '',
    folderUrl: s.folder && !s.folder.startsWith('drive:')
      ? BUCKET_CONSOLE + encodeURIComponent(s.folder).replace(/%2F/g, '~2F')
      : s.folder ? 'https://drive.google.com/drive/folders/' + s.folder.slice(6) : '',
    appliedAt: iso(s.appliedAt),
    verifiedAt: iso(s.verifiedAt),
    hasLogin: !!s.userId,
  };
}

async function adminLawyers() {
  return docs(await db.collection('Staff').get())
    .map(toAdminLawyer)
    .sort((a, b) => String(b.appliedAt).localeCompare(String(a.appliedAt)));
}

async function pending(lawyerId) {
  const s = await lawyerById(String(lawyerId || ''));
  if (!s) throw new ApiError('NOT_FOUND');
  if (s.status !== 'applied') throw new ApiError('NOT_PENDING');
  return s;
}

async function approve(caller, data, env) {
  const s = await pending(data.lawyerId);
  const auth = getAuth();
  const email = String(s.email).trim().toLowerCase();
  const fullName = `${s.firstName} ${s.lastName}`.trim();

  let user;
  try {
    user = await auth.getUserByEmail(email);
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err;
    // We checked who they are, and the invite goes to this address
    user = await auth.createUser({ email, displayName: fullName, emailVerified: true });
  }
  await auth.setCustomUserClaims(user.uid, { ...(user.customClaims || {}), staff: true, lawyerId: s.id });
  const link = await auth.generatePasswordResetLink(email, { url: `${env.origin}/login` });

  await db.doc('Staff/' + s.id).update({ userId: user.uid, status: 'approved', verifiedAt: now(), updatedAt: now() });
  await mail(env, {
    to: email,
    subject: 'Welcome to AI Law — set up your Workspace login',
    text: [
      `Dear ${s.firstName},`,
      '',
      'Your application to work with AI Law has been approved. Welcome to the team.',
      '',
      'Set your password with this link:',
      link,
      '',
      `Then log in at ${env.origin}/login with ${email}. You can also use "Continue with Google" with this same email address.`,
      'After logging in you will land in your Workspace, where your assignments appear.',
      '',
      `Your lawyer code: ${s.id}`,
      '',
      'AI Law LLC · www.ailaw.llc',
    ].join('\n'),
  });
  return adminLawyers();
}

async function reject(caller, data, env) {
  const s = await pending(data.lawyerId);
  await db.doc('Staff/' + s.id).update({
    status: 'left',
    updatedAt: now(),
    notes: [s.notes, `Not approved ${now().toISOString().slice(0, 10)}`].filter(Boolean).join(' · '),
  });
  await mail(env, {
    to: s.email,
    subject: 'Your application to AI Law',
    text: [
      `Dear ${s.firstName},`,
      '',
      'Thank you for your interest in working with AI Law and for the time you put into your application.',
      '',
      'After reviewing it, we are not able to offer you a place at this time. We will keep your details and may contact you if a suitable opportunity comes up.',
      '',
      'AI Law LLC · www.ailaw.llc',
    ].join('\n'),
  });
  return adminLawyers();
}

export default {
  id: 'lawyer-verification',
  sides: ['lawyer', 'admin'],
  actions: {
    lawyer: {
      apply: { public: true, run: apply },
    },
    admin: {
      'admin:lawyers': () => adminLawyers(),
      'admin:approveLawyer': (caller, data, env) => approve(caller, data, env),
      'admin:rejectLawyer': (caller, data, env) => reject(caller, data, env),
    },
  },
};
