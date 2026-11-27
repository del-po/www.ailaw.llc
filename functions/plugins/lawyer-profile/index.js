// ==========================================================
// Plugin: lawyer profile (lawyer)
//   staff:profile        the lawyer's own record and earnings: fees of
//                        finished assignments (earned) and open ones (pending)
//   staff:updateProfile  what a lawyer may change themselves: phone,
//                        address, languages, specializations, availability,
//                        bio, IBAN. Name, bar licence and personal ID are
//                        changed by AI Law only.
// ==========================================================

import { ApiError, cleanText, db, iso, now } from '../../core/app.js';
import { lawyerById, orderByNumber } from '../../core/records.js';

const list = (text) =>
  String(text || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

async function own(caller) {
  const s = await lawyerById(caller.lawyerId);
  if (!s || s.userId !== caller.uid || ['suspended', 'left'].includes(s.status)) throw new ApiError('FORBIDDEN');
  return s;
}

async function earnings(lawyerId) {
  const snap = await db.collectionGroup('Assignments').where('lawyerId', '==', lawyerId).get();
  const rows = [];
  for (const doc of snap.docs) {
    const a = doc.data();
    if (a.status === 'cancelled') continue;
    const order = (await orderByNumber(doc.ref.parent.parent.id)) || {};
    rows.push({
      assignmentId: doc.id,
      orderNumber: order.orderNumber || doc.ref.parent.parent.id,
      service: order.serviceName || '',
      fee: Number(a.fee) || 0,
      currency: order.currency || 'GEL',
      status: a.status,
      completedAt: iso(a.completedAt),
    });
  }
  const sum = (filter) => rows.filter(filter).reduce((total, r) => total + r.fee, 0);
  return {
    earned: sum((r) => r.status === 'done'),
    pending: sum((r) => r.status !== 'done'),
    currency: 'GEL',
    rows: rows.sort((x, y) => String(y.completedAt).localeCompare(String(x.completedAt))),
  };
}

function toProfile(s) {
  return {
    lawyerId: s.id,
    firstName: s.firstName,
    lastName: s.lastName,
    email: s.email,
    phone: String(s.phone || ''),
    address: s.address || '',
    barLicenseNumber: String(s.barLicenseNumber || ''),
    specializations: (s.specializations || []).join(', '),
    languages: (s.languages || []).join(', '),
    availability: s.availability || '',
    bio: s.bio || '',
    // Only the last four characters are ever shown back
    iban: s.iban ? '•••• ' + String(s.iban).slice(-4) : '',
    status: s.status,
    verifiedAt: iso(s.verifiedAt),
  };
}

async function profile(caller) {
  const s = await own(caller);
  return { profile: toProfile(s), earnings: await earnings(s.id) };
}

async function updateProfile(caller, data) {
  const s = await own(caller);
  const changes = { updatedAt: now() };
  if (data.phone !== undefined) changes.phone = cleanText(data.phone, 30);
  if (data.address !== undefined) changes.address = cleanText(data.address, 300);
  if (data.availability !== undefined) changes.availability = cleanText(data.availability, 300);
  if (data.bio !== undefined) changes.bio = cleanText(data.bio, 2000);
  if (data.languages !== undefined) changes.languages = list(cleanText(data.languages, 200));
  if (data.specializations !== undefined) changes.specializations = list(cleanText(data.specializations, 500));
  // An empty IBAN field leaves the saved one as it is
  if (data.iban) {
    const iban = String(data.iban).replace(/\s+/g, '').toUpperCase();
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) throw new ApiError('INVALID_IBAN');
    changes.iban = iban;
  }
  await db.doc('Staff/' + s.id).update(changes);
  return profile(caller);
}

export default {
  id: 'lawyer-profile',
  sides: ['lawyer'],
  actions: {
    lawyer: {
      'staff:profile': (caller) => profile(caller),
      'staff:updateProfile': (caller, data) => updateProfile(caller, data),
    },
  },
};
