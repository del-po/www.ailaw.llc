// ==========================================================
// Plugin: assignments (lawyer)
//   staff:me           the signed-in lawyer; the first visit turns
//                      "approved" into "active"
//   staff:assignments  their assignments, newest first; cancelled ones are
//                      left out, and a lawyer never sees anyone else's
// Assignments live inside each order: Orders/{AIL-…}/Assignments.
// ==========================================================

import { ApiError, db, iso, now } from '../../core/app.js';
import { lawyerById, orderByNumber } from '../../core/records.js';

async function me(caller) {
  const s = await lawyerById(caller.lawyerId);
  if (!s || s.userId !== caller.uid || ['suspended', 'left'].includes(s.status)) throw new ApiError('FORBIDDEN');
  if (s.status === 'approved') {
    await db.doc('Staff/' + s.id).update({ status: 'active', updatedAt: now() });
    s.status = 'active';
  }
  return { lawyerId: s.id, firstName: s.firstName, lastName: s.lastName, email: s.email, status: s.status };
}

async function assignments(caller) {
  await me(caller);
  const snap = await db.collectionGroup('Assignments').where('lawyerId', '==', caller.lawyerId).get();
  const result = [];
  for (const doc of snap.docs) {
    const a = doc.data();
    if (a.status === 'cancelled') continue;
    const order = (await orderByNumber(doc.ref.parent.parent.id)) || {};
    result.push({
      assignmentId: doc.id,
      orderNumber: order.orderNumber || doc.ref.parent.parent.id,
      service: order.serviceName || '',
      client: order.customerName || '',
      role: a.role || 'lead',
      status: a.status || 'assigned',
      tasks: Array.isArray(a.tasks) ? a.tasks.join('\n') : String(a.tasks || ''),
      fee: a.fee === '' || a.fee == null ? null : Number(a.fee),
      currency: order.currency || 'GEL',
      assignedAt: iso(a.assignedAt),
      completedAt: iso(a.completedAt),
      orderStatus: order.orderStatus || '',
      paymentStatus: order.paymentStatus || '',
    });
  }
  return result.sort((x, y) => y.assignedAt.localeCompare(x.assignedAt));
}

export default {
  id: 'assignments',
  sides: ['lawyer'],
  actions: {
    lawyer: {
      'staff:me': (caller) => me(caller),
      'staff:assignments': (caller) => assignments(caller),
    },
  },
};
