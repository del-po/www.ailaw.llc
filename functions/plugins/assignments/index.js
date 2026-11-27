// ==========================================================
// Plugin: assignments (lawyer)
//   staff:me           the signed-in lawyer; the first visit turns
//                      "approved" into "active"
//   staff:assignments  their assignments, newest first; cancelled ones are
//                      left out, and a lawyer never sees anyone else's
//   staff:case         one assignment in full: order details, steps,
//                      documents, and its chat thread; opening it the first
//                      time marks the assignment "in progress"
//   staff:document     downloads one file of the case
//   staff:upload       a working file → the lawyer's own folder under the
//                      order's "Internal" folder (never shown to the client)
//   staff:deliver      the lead lawyer's result → the client's order folder
//                      (their Documents page) and to the client by email;
//                      the assignment is done
// The case chat is scoped to the assignment (chatScope): one thread per
// assignment, with the case in the AI's instructions and only the
// service's own know-how.
// Assignments live inside each order: Orders/{AIL-…}/Assignments.
// ==========================================================

import { ApiError, cleanKey, cleanName, cleanText, db, iso, now } from '../../core/app.js';
import { scopedConversation } from '../../core/chat.js';
import { join, listFolder, readFile, saveFile } from '../../core/files.js';
import { lawyerById, orderByNumber, orderItems, orderSteps, serviceBySlug } from '../../core/records.js';
import { completeStep, mail } from '../../core/steps.js';

const INTERNAL = 'Internal';
const MAX_BYTES = 15 * 1024 * 1024;
const FILE_TYPES = {
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'text/plain': '.txt',
};

async function me(caller) {
  const s = await lawyerById(caller.lawyerId);
  if (!s || s.userId !== caller.uid || ['suspended', 'left'].includes(s.status)) throw new ApiError('FORBIDDEN');
  if (s.status === 'approved') {
    await db.doc('Staff/' + s.id).update({ status: 'active', updatedAt: now() });
    s.status = 'active';
  }
  return { lawyerId: s.id, firstName: s.firstName, lastName: s.lastName, email: s.email, status: s.status };
}

function toAssignment(id, a, order) {
  return {
    assignmentId: id,
    orderNumber: order.orderNumber || '',
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
  };
}

async function assignments(caller) {
  await me(caller);
  const snap = await db.collectionGroup('Assignments').where('lawyerId', '==', caller.lawyerId).get();
  const result = [];
  for (const doc of snap.docs) {
    const a = doc.data();
    if (a.status === 'cancelled') continue;
    const order = (await orderByNumber(doc.ref.parent.parent.id)) || { orderNumber: doc.ref.parent.parent.id };
    result.push(toAssignment(doc.id, a, order));
  }
  return result.sort((x, y) => y.assignedAt.localeCompare(x.assignedAt));
}

// One of the caller's own assignments, with its order; anything else is refused
async function ownAssignment(caller, assignmentId) {
  const id = cleanKey(assignmentId, 'NOT_FOUND');
  const snap = await db.collectionGroup('Assignments').where('lawyerId', '==', caller.lawyerId).get();
  const doc = snap.docs.find((d) => d.id === id);
  if (!doc || doc.data().status === 'cancelled') throw new ApiError('NOT_FOUND');
  const order = await orderByNumber(doc.ref.parent.parent.id);
  if (!order) throw new ApiError('NOT_FOUND');
  return { ref: doc.ref, assignment: { id, ...doc.data() }, order };
}

// ---------- Documents ----------

// The case's files: the client's (the order folder) and every lawyer's
// working folder under Internal. Paths are relative to the order folder.
async function caseDocuments(order) {
  if (!order.folder || order.folder.startsWith('drive:')) return [];
  const groups = [];
  const top = await listFolder(order.folder);
  groups.push({ title: 'Client', files: top.files.map((f) => toFile(f, f.name)) });

  const internal = (await listFolder(join(order.folder, INTERNAL))).folders;
  for (const folder of internal) {
    const content = await listFolder(folder.path);
    groups.push({
      title: folder.name,
      files: content.files.map((f) => toFile(f, join(INTERNAL, folder.name, f.name))),
    });
  }
  return groups;
}

const toFile = (f, path) => ({ path, name: f.name, type: f.contentType, size: f.size, updatedAt: iso(f.updatedAt) });

function insideCase(path) {
  const parts = String(path || '').split('/').filter(Boolean);
  if (!parts.length || parts.some((p) => p === '..' || p === '.')) throw new ApiError('DOCUMENT_NOT_FOUND');
  return parts;
}

async function document(caller, data) {
  const { order } = await ownAssignment(caller, data.assignmentId);
  const file = await readFile(join(order.folder, ...insideCase(data.path)));
  if (!file) throw new ApiError('DOCUMENT_NOT_FOUND');
  if (file.size > 25 * 1024 * 1024) throw new ApiError('DOCUMENT_TOO_LARGE');
  return { name: data.path.split('/').pop(), mimeType: file.contentType, data: file.content.toString('base64') };
}

// An uploaded file, checked: { name, type, data (base64) }
function checkUpload(file) {
  const type = String(file?.type || '').toLowerCase();
  if (!FILE_TYPES[type]) throw new ApiError('INVALID_FILE_TYPE');
  const content = Buffer.from(String(file.data || ''), 'base64');
  if (!content.length) throw new ApiError('INVALID_FILE');
  if (content.length > MAX_BYTES) throw new ApiError('FILE_TOO_LARGE');
  const name = cleanName(String(file.name || '').replace(/\.[^.]+$/, '')).slice(0, 120) || 'Document';
  return { type, content, name: name + FILE_TYPES[type] };
}

// The lawyer's own working folder for this assignment
function ownFolder(order, assignment) {
  return assignment.internalFolder && !assignment.internalFolder.startsWith('drive:')
    ? assignment.internalFolder
    : join(order.folder, INTERNAL, `${assignment.lawyerId} - ${assignment.lawyerName} (${assignment.role})`);
}

async function upload(caller, data) {
  const { order, assignment, ref } = await ownAssignment(caller, data.assignmentId);
  if (!order.folder || order.folder.startsWith('drive:')) throw new ApiError('ORDER_HAS_NO_FOLDER');
  const file = checkUpload(data.file);
  await saveFile(join(ownFolder(order, assignment), file.name), file.content, file.type);
  await started(ref, assignment);
  return caseDocuments(order);
}

// ---------- Delivery ----------

async function deliver(caller, data, env) {
  const { order, assignment, ref } = await ownAssignment(caller, data.assignmentId);
  if (assignment.role !== 'lead') throw new ApiError('ONLY_LEAD_DELIVERS');
  if (assignment.status === 'done') throw new ApiError('ALREADY_DELIVERED');
  if (!order.folder || order.folder.startsWith('drive:')) throw new ApiError('ORDER_HAS_NO_FOLDER');
  const file = checkUpload(data.file);
  const note = cleanText(data.note, 2000);
  const path = await saveFile(join(order.folder, file.name), file.content, file.type);

  // A service with steps: the lawyer's step is done with this file, and the
  // service's own delivery step sends it on
  const steps = await orderSteps(order.orderNumber);
  const waiting = steps.find((s) => s.owner === 'lawyer' && s.status === 'active');
  if (waiting) {
    await completeStep(order.orderNumber, waiting.stepNo, 'file:' + path, note, env);
  } else {
    await mail(env, {
      to: order.customerEmail,
      subject: `AI Law — ${order.serviceName} (${order.orderNumber})`,
      text: [
        order.customerName ? `Dear ${order.customerName},` : 'Hello,',
        '',
        `The work on your order ${order.orderNumber} (${order.serviceName}) is ready. The document is attached, and it is also in your account under Documents.`,
        note ? '\n' + note : '',
        '',
        'Questions? Just reply to this email.',
        '',
        'AI Law LLC · www.ailaw.llc',
      ].join('\n'),
      attachments: [{ filename: file.name, content: file.content, contentType: file.type }],
    });
    // Without steps, the lead's delivery completes the order
    if (!steps.length) {
      await db.doc('Orders/' + order.orderNumber).update({ orderStatus: 'completed', completedAt: now(), updatedAt: now() });
    }
  }
  await ref.update({ status: 'done', completedAt: now(), startedAt: assignment.startedAt || now(), notes: note || assignment.notes || '' });
  return caseOf(caller, { assignmentId: data.assignmentId });
}

// ---------- The case ----------

async function started(ref, assignment) {
  if (assignment.status === 'assigned') {
    await ref.update({ status: 'in_progress', startedAt: now() });
    assignment.status = 'in_progress';
  }
}

async function caseOf(caller, data) {
  const { order, assignment, ref } = await ownAssignment(caller, data.assignmentId);
  await started(ref, assignment);
  const steps = await orderSteps(order.orderNumber);
  return {
    assignment: toAssignment(assignment.id, assignment, order),
    details: order.details || {},
    notes: order.customerNotes || '',
    items: (await orderItems(order.orderNumber)).map((i) => ({ name: i.name, quantity: Number(i.quantity) })),
    steps: steps.map((s) => ({ label: s.clientLabel, owner: s.owner, status: s.status, task: s.lawyerTask || '' })),
    documents: await caseDocuments(order),
    chat: await scopedConversation(caller, 'lawyer', 'assignment:' + assignment.id),
  };
}

// The case chat's scope: this assignment's facts, and only its service's know-how
async function chatScope(caller, data) {
  if (!data.assignmentId) return null;
  const { order, assignment } = await ownAssignment(caller, data.assignmentId);
  const service = order.serviceId ? await serviceBySlug(order.serviceId) : null;
  const documents = (await caseDocuments(order)).flatMap((g) => g.files.map((f) => `${g.title}: ${f.name}`));
  const tasks = Array.isArray(assignment.tasks) ? assignment.tasks : [];
  const prompt = [
    '## This assignment',
    'You are helping with this one assignment only. Do not discuss other clients or cases.',
    `Service: ${order.serviceName} · Order ${order.orderNumber}`,
    `Your role: ${assignment.role}`,
    `Client: ${order.customerName || '—'}`,
    Object.keys(order.details || {}).length ? `Order details: ${JSON.stringify(order.details)}` : '',
    order.customerNotes ? `Client's note: ${order.customerNotes}` : '',
    tasks.length ? 'Tasks:\n' + tasks.map((t, i) => `${i + 1}. ${t}`).join('\n') : '',
    documents.length ? 'Documents in the case (names only; you cannot open them):\n' + documents.join('\n') : '',
  ]
    .filter(Boolean)
    .join('\n');
  return { key: 'assignment:' + assignment.id, prompt, pluginIds: service?.plugin ? [service.plugin] : [] };
}

export default {
  id: 'assignments',
  sides: ['lawyer'],
  actions: {
    lawyer: {
      'staff:me': (caller) => me(caller),
      'staff:assignments': (caller) => assignments(caller),
      'staff:case': (caller, data) => caseOf(caller, data),
      'staff:document': (caller, data) => document(caller, data),
      'staff:upload': (caller, data) => upload(caller, data),
      'staff:deliver': (caller, data, env) => deliver(caller, data, env),
    },
  },
  chatScope,
};
