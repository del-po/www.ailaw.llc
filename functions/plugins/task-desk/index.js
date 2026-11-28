// ==========================================================
// Plugin: task desk (admin)
// Orders:
//   adminListOrders, adminGetOrder
//   adminUpdateOrder   statuses; paid → PaidAt and "in progress" here, the
//                      receipt and the next steps by the on-paid job
// Lawyer work:
//   admin:tasks         lawyer steps waiting to be done, and results waiting
//                       for approval (status review), oldest first
//   admin:completeStep  marks one done (with its file link) and moves on
//   admin:assign        gives an order to a lawyer: an Assignments record,
//                       their own folder under the order's "Internal"
//                       folder (never shown to the client), and an email
// ==========================================================

import { ApiError, cleanKey, cleanText, db, iso, now, toDate, uuid } from '../../core/app.js';
import { join, makeFolder } from '../../core/files.js';
import { pluginRecords } from '../../core/loader.js';
import { toOrder } from '../../core/orders.js';
import { docs, lawyerById, orderById, orderByNumber, orderItems, serviceBySlug } from '../../core/records.js';
import { completeStep, mail, resumePaid } from '../../core/steps.js';

const ORDER_STATUSES = ['placed', 'in_progress', 'completed', 'cancelled'];
const PAYMENT_STATUSES = ['unpaid', 'paid', 'refunded'];
const ROLES = ['lead', 'reviewer'];

// ---------- Orders ----------

async function listOrders() {
  const snap = await db.collection('Orders').orderBy('createdAt', 'desc').limit(500).get();
  return docs(snap).map((o) => toOrder(o));
}

// One order with its items and the lawyers on it
async function getOrder(orderId) {
  const order = await orderById(cleanKey(orderId));
  if (!order) throw new ApiError('ORDER_NOT_FOUND');
  const assignments = docs(await db.collection(`Orders/${order.orderNumber}/Assignments`).get())
    .filter((a) => a.status !== 'cancelled')
    .map((a) => ({ lawyerId: a.lawyerId, lawyerName: a.lawyerName, role: a.role, status: a.status }));
  return { ...toOrder(order, await orderItems(order.orderNumber)), assignments };
}

async function updateOrder(data) {
  const order = await orderById(cleanKey(data.orderId));
  if (!order) throw new ApiError('ORDER_NOT_FOUND');
  const changes = { updatedAt: now() };

  if (data.orderStatus !== undefined) {
    if (!ORDER_STATUSES.includes(data.orderStatus)) throw new ApiError('INVALID_STATUS');
    changes.orderStatus = data.orderStatus;
    if (data.orderStatus === 'completed' && !order.completedAt) changes.completedAt = now();
  }
  if (data.paymentStatus !== undefined) {
    if (!PAYMENT_STATUSES.includes(data.paymentStatus)) throw new ApiError('INVALID_STATUS');
    changes.paymentStatus = data.paymentStatus;
    if (data.paymentStatus === 'paid' && !order.paidAt) {
      changes.paidAt = now();
      // Paid while still "placed" → work starts
      if ((changes.orderStatus || order.orderStatus) === 'placed') changes.orderStatus = 'in_progress';
    }
  }
  await db.doc('Orders/' + order.orderNumber).update(changes);
  return getOrder(order.orderId);
}

// ---------- Lawyer steps ----------

async function tasks(env) {
  await resumePaid(env);
  // Lawyer steps waiting to be done, and results waiting for AI Law's approval
  const snap = await db.collectionGroup('Steps').where('owner', '==', 'lawyer').where('status', 'in', ['active', 'review']).get();
  const list = [];
  for (const doc of snap.docs) {
    const s = doc.data();
    const order = (await orderByNumber(doc.ref.parent.parent.id)) || {};
    list.push({
      orderId: order.orderNumber,
      stepNo: Number(s.stepNo),
      status: s.status,
      result: s.result || '',
      note: s.note || '',
      dueAt: iso(s.dueAt),
      label: s.clientLabel,
      task: s.lawyerTask,
      needsFile: !!s.config?.needsFile,
      service: order.serviceName,
      clientName: order.customerName,
      clientEmail: order.customerEmail,
      price: Number(order.total),
      currency: order.currency,
      details: order.details || {},
      createdAt: toDate(order.createdAt)?.getTime() || 0,
      waitingSince: toDate(s.updatedAt)?.getTime() || 0,
    });
  }
  return list.sort((a, b) => a.waitingSince - b.waitingSince);
}

// ---------- Assigning a lawyer ----------

// The lawyer steps of the order's service, e.g. "1. File the declaration …"
async function lawyerTasks(order) {
  const service = order.serviceId ? await serviceBySlug(order.serviceId) : null;
  const plugin = service?.plugin ? (await pluginRecords())[service.plugin] : null;
  return (plugin?.steps || [])
    .filter((s) => s.owner === 'lawyer')
    .sort((a, b) => a.stepNo - b.stepNo)
    .map((s) => s.lawyerTask || s.clientLabel)
    .filter(Boolean);
}

async function assign(caller, data, env) {
  const order = await orderByNumber(cleanKey(data.orderNumber));
  if (!order) throw new ApiError('ORDER_NOT_FOUND');
  if (!['placed', 'in_progress'].includes(order.orderStatus)) throw new ApiError('ORDER_CLOSED');
  if (!order.folder || order.folder.startsWith('drive:')) throw new ApiError('ORDER_HAS_NO_FOLDER');
  const lawyer = await lawyerById(cleanKey(data.lawyerId));
  if (!lawyer || !['approved', 'active'].includes(lawyer.status)) throw new ApiError('LAWYER_NOT_AVAILABLE');
  const role = ROLES.includes(data.role) ? data.role : 'lead';

  const existing = docs(await db.collection(`Orders/${order.orderNumber}/Assignments`).where('lawyerId', '==', lawyer.id).get());
  if (existing.some((a) => a.status !== 'cancelled')) throw new ApiError('ALREADY_ASSIGNED');

  const name = `${lawyer.firstName} ${lawyer.lastName}`.trim();
  const internal = order.internalFolder && !order.internalFolder.startsWith('drive:')
    ? order.internalFolder
    : await makeFolder(join(order.folder, 'Internal'));
  const own = await makeFolder(join(internal, `${lawyer.id} - ${name} (${role})`));
  const service = order.serviceId ? await serviceBySlug(order.serviceId) : null;
  const list = data.tasks ? [cleanText(data.tasks, 2000)] : await lawyerTasks(order);

  const assignmentId = 'AS-' + uuid().replace(/-/g, '').slice(0, 8).toUpperCase();
  const record = {
    lawyerId: lawyer.id,
    lawyerName: name,
    role,
    status: 'assigned',
    tasks: list,
    fee: role === 'lead' && service?.lawyerFee ? Number(service.lawyerFee) : 0,
    minutes: 0,
    assignedAt: now(),
    startedAt: null,
    completedAt: null,
    notifiedAt: null,
    internalFolder: own,
    notes: '',
  };
  await db.doc(`Orders/${order.orderNumber}/Assignments/${assignmentId}`).set(record);
  await db.doc('Orders/' + order.orderNumber).update({ internalFolder: internal, updatedAt: now() });

  const sent = await mail(env, {
    to: lawyer.email,
    subject: `New assignment — ${order.orderNumber}`,
    text: [
      `Dear ${lawyer.firstName},`,
      '',
      `You have a new assignment${role === 'lead' ? '' : ' as ' + role}:`,
      '',
      `• ${order.serviceName} — order ${order.orderNumber}`,
      list.length ? '• Your tasks: ' + list.join('; ') : '',
      '',
      'Open it in your Workspace: https://www.ailaw.llc/workspace',
      '',
      'AI Law LLC · www.ailaw.llc',
    ]
      .filter((line, i, all) => line !== '' || all[i - 1] !== '')
      .join('\n'),
  });
  if (sent) await db.doc(`Orders/${order.orderNumber}/Assignments/${assignmentId}`).update({ notifiedAt: now() });
  return { assignmentId, ...record, assignedAt: iso(record.assignedAt) };
}

export default {
  id: 'task-desk',
  sides: ['admin'],
  actions: {
    admin: {
      adminListOrders: () => listOrders(),
      adminGetOrder: (caller, data) => getOrder(data.orderId),
      adminUpdateOrder: (caller, data) => updateOrder(data),
      'admin:tasks': (caller, data, env) => tasks(env),
      'admin:completeStep': async (caller, data, env) => {
        await completeStep(cleanKey(data.orderId), data.stepNo, data.result, [data.note, caller.email].filter(Boolean).join(' — '), env);
        return tasks(env);
      },
      'admin:assign': (caller, data, env) => assign(caller, data, env),
    },
  },
};
