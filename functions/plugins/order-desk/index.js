// ==========================================================
// Plugin: order desk (admin)
// Each order's own workspace in the Admin Panel (/admin/orders/AIL-…):
//   order:get            the order, its client, items, workflow steps,
//                        lawyers, documents (with Internal) and history
//   order:edit           details the client gave (name, email, phone,
//                        notes, details), AI Law's own notes, the deadline
//   order:prices         line prices and discounts, while unpaid; the
//                        totals follow (remake the agreement afterwards)
//   order:step           one step: complete, correct, approve, send back,
//                        restart, skip, or edit (label, task, deadline)
//   order:startWorkflow  runs the service's workflow on an order without steps
//   order:unassign       takes a lawyer off the order (reassigning is this,
//                        then admin:assign)
// The order's files are read and changed through the file desk
// (files:list, files:upload … on the order's folder): one way for both.
// Every change is in the audit log (core/audit.js); order:get shows the
// order's part of it as its history.
// ==========================================================

import { ApiError, cleanKey, cleanText, db, iso, now, toDate, validEmail } from '../../core/app.js';
import { proposeAction } from '../../core/chat-actions.js';
import { listFolder } from '../../core/files.js';
import { toOrder } from '../../core/orders.js';
import { clientById, docs, lawyerById, orderByNumber, orderItems, orderSteps, serviceBySlug } from '../../core/records.js';
import { advance, approveStep, isResult, mail } from '../../core/steps.js';
import { workflowOf } from '../../core/workflow.js';
import { startWorkflow } from '../ordering/index.js';
import { upload } from '../file-desk/index.js';

const OPEN = ['placed', 'in_progress'];
const DAY_TEXT = /^\d{4}-\d{2}-\d{2}$/;

async function requireOrder(orderNumber) {
  const order = await orderByNumber(cleanKey(orderNumber, 'ORDER_NOT_FOUND'));
  if (!order) throw new ApiError('ORDER_NOT_FOUND');
  return order;
}

// "2026-12-05" → the end of that Tbilisi day; '' or null → no deadline
function dueDate(value) {
  if (value === '' || value === null) return null;
  if (!DAY_TEXT.test(String(value))) throw new ApiError('INVALID_DEADLINE');
  return new Date(value + 'T23:59:59+04:00');
}

// ---------- The workspace ----------

const toStep = (s) => ({
  stepNo: Number(s.stepNo),
  owner: s.owner,
  capability: s.capability || '',
  clientLabel: s.clientLabel || '',
  lawyerTask: s.lawyerTask || '',
  config: s.config || {},
  status: s.status,
  result: s.result || '',
  note: s.note || '',
  error: s.error || '',
  dueAt: iso(s.dueAt),
  updatedAt: iso(s.updatedAt),
  late: !!s.dueAt && !['done', 'skipped'].includes(s.status) && toDate(s.dueAt) < new Date(),
});

// The order folder's files, and each subfolder's (Internal and its lawyer folders too), two levels down
async function folderTree(path, depth = 0) {
  if (!path || path.startsWith('drive:')) return null;
  const content = await listFolder(path);
  const folders = [];
  for (const f of content.folders) {
    folders.push(depth < 2 ? await folderTree(f.path, depth + 1) : { name: f.name, path: f.path, files: [], folders: [] });
  }
  return {
    name: path.split('/').pop(),
    path,
    files: content.files.map((f) => ({ name: f.name, path: f.path, size: f.size, contentType: f.contentType, updatedAt: iso(f.updatedAt) })),
    folders,
  };
}

async function workspace(data) {
  const order = await requireOrder(data.orderNumber);
  const [items, steps, assignments, client, history, files] = await Promise.all([
    orderItems(order.orderNumber),
    orderSteps(order.orderNumber),
    db.collection(`Orders/${order.orderNumber}/Assignments`).get(),
    order.clientId ? clientById(order.clientId) : null,
    db.collection('AuditLog').where('target.id', '==', order.orderNumber).limit(200).get(),
    folderTree(order.folder),
  ]);
  const service = order.serviceId ? await serviceBySlug(order.serviceId) : null;

  return {
    order: {
      ...toOrder(order, items),
      dueAt: iso(order.dueAt),
      adminNotes: order.adminNotes || '',
      folder: order.folder && !order.folder.startsWith('drive:') ? order.folder : '',
      agreement: order.agreement || '',
      emailedAt: iso(order.emailedAt),
    },
    client: client
      ? {
          clientId: client.id,
          name: client.displayName || '',
          email: client.email || '',
          phone: client.phone || '',
          type: client.type,
          status: client.status,
          notes: client.notes || '',
        }
      : null,
    steps: steps.map(toStep),
    // A service with a workflow, on an order that has none yet (e.g. placed before it was set)
    canStartWorkflow: !steps.length && (await workflowOf(service)).length > 0,
    assignments: docs(assignments)
      .map((a) => ({
        assignmentId: a.id,
        lawyerId: a.lawyerId,
        lawyerName: a.lawyerName,
        role: a.role,
        status: a.status,
        tasks: Array.isArray(a.tasks) ? a.tasks : [],
        fee: Number(a.fee || 0),
        assignedAt: iso(a.assignedAt),
        completedAt: iso(a.completedAt),
      }))
      .sort((a, b) => a.assignedAt.localeCompare(b.assignedAt)),
    files,
    history: docs(history)
      .map((h) => ({
        id: h.id,
        time: iso(h.time),
        who: h.name || h.email || h.uid,
        via: h.via || 'panel',
        action: h.action,
        changes: h.changes || null,
        ok: h.ok !== false,
        error: h.error || '',
      }))
      .sort((a, b) => b.time.localeCompare(a.time)),
  };
}

// ---------- Details ----------

const EDITABLE = { customerName: 200, customerPhone: 30, customerNotes: 2000, adminNotes: 5000, billingAddress: 300 };

async function edit(data) {
  const order = await requireOrder(data.orderNumber);
  const changes = {};
  for (const [key, max] of Object.entries(EDITABLE)) {
    if (data[key] !== undefined) changes[key] = cleanText(data[key], max, 'INVALID_ORDER_DATA');
  }
  if (data.customerEmail !== undefined) {
    const email = String(data.customerEmail).trim().toLowerCase();
    if (!validEmail(email)) throw new ApiError('INVALID_EMAIL');
    changes.customerEmail = email;
  }
  if (data.details !== undefined) {
    if (!data.details || typeof data.details !== 'object' || Array.isArray(data.details)) throw new ApiError('INVALID_ORDER_DATA');
    const details = {};
    for (const [k, v] of Object.entries(data.details).slice(0, 50)) {
      details[cleanText(k, 60, 'INVALID_ORDER_DATA')] = typeof v === 'number' ? v : cleanText(v, 2000, 'INVALID_ORDER_DATA');
    }
    changes.details = details;
  }
  if (data.dueAt !== undefined) changes.dueAt = dueDate(data.dueAt);
  if (!Object.keys(changes).length) throw new ApiError('NOTHING_TO_CHANGE');
  await db.doc('Orders/' + order.orderNumber).update({ ...changes, updatedAt: now() });
  return workspace({ orderNumber: order.orderNumber });
}

// New line prices and discounts; quantities and taxes stay. Only while
// unpaid, and not for ongoing services (their fee is per unit)
async function prices(data) {
  const order = await requireOrder(data.orderNumber);
  if (order.paymentStatus !== 'unpaid') throw new ApiError('ORDER_ALREADY_PAID');
  if (order.billing === 'ongoing') throw new ApiError('ONGOING_PRICE_FIXED');
  const items = await orderItems(order.orderNumber);
  const wanted = Array.isArray(data.items) ? data.items : [];
  const cents = (n) => Math.round(Number(n) * 100);
  const batch = db.batch();
  let subtotal = 0;
  let discounts = 0;
  let taxes = 0;
  for (const item of items) {
    const change = wanted.find((w) => w.orderItemId === item.id) || {};
    const unit = change.unitPrice !== undefined ? cents(change.unitPrice) : cents(item.unitPrice);
    const discount = change.discountAmount !== undefined ? cents(change.discountAmount) : cents(item.discountAmount);
    const quantity = Number(item.quantity) || 1;
    const tax = cents(item.taxAmount || 0);
    if (!Number.isFinite(unit) || unit < 0 || !Number.isFinite(discount) || discount < 0 || discount > unit * quantity) {
      throw new ApiError('INVALID_PRICE');
    }
    subtotal += unit * quantity;
    discounts += discount;
    taxes += tax;
    batch.update(db.doc(`Orders/${order.orderNumber}/Items/${item.id}`), {
      unitPrice: unit / 100,
      discountAmount: discount / 100,
      lineTotal: (unit * quantity - discount + tax) / 100,
    });
  }
  batch.update(db.doc('Orders/' + order.orderNumber), {
    subtotal: subtotal / 100,
    discountTotal: discounts / 100,
    taxTotal: taxes / 100,
    total: (subtotal - discounts + taxes) / 100,
    updatedAt: now(),
  });
  await batch.commit();
  return workspace({ orderNumber: order.orderNumber });
}

// ---------- Steps ----------

const STEP_OPS = ['complete', 'correct', 'approve', 'sendBack', 'restart', 'skip', 'edit'];

// A result typed or uploaded: an uploaded file goes into the order's folder
async function resultOf(order, data) {
  if (data.file) {
    if (!order.folder || order.folder.startsWith('drive:')) throw new ApiError('ORDER_HAS_NO_FOLDER');
    const saved = await upload({ folder: order.folder, file: data.file, replace: data.replace === true });
    return 'file:' + saved.path;
  }
  return cleanText(data.result ?? '', 2000, 'INVALID_RESULT');
}

async function step(caller, data, env) {
  const order = await requireOrder(data.orderNumber);
  const op = String(data.op || '');
  if (!STEP_OPS.includes(op)) throw new ApiError('INVALID_REQUEST');
  const s = (await orderSteps(order.orderNumber)).find((x) => x.stepNo === Number(data.stepNo));
  if (!s) throw new ApiError('STEP_NOT_FOUND');
  const ref = db.doc(`Orders/${order.orderNumber}/Steps/${s.id}`);
  const note = data.note !== undefined ? cleanText(data.note, 2000) : undefined;
  const by = [note, caller.email].filter(Boolean).join(' — ');
  if (order.orderStatus === 'cancelled' && op !== 'edit') throw new ApiError('ORDER_CLOSED');

  if (op === 'complete') {
    if (['done', 'skipped'].includes(s.status)) throw new ApiError('STEP_ALREADY_DONE');
    const result = await resultOf(order, data);
    if (s.config?.needsFile && !isResult(result)) throw new ApiError('FILE_LINK_REQUIRED');
    await ref.update({ status: 'done', result: result || 'Done by AI Law', note: by, error: '', updatedAt: now() });
    await advance(order.orderNumber, env);
  } else if (op === 'correct') {
    if (s.status !== 'done') throw new ApiError('STEP_NOT_DONE');
    const result = await resultOf(order, data);
    if (s.config?.needsFile && !isResult(result)) throw new ApiError('FILE_LINK_REQUIRED');
    await ref.update({ result, ...(note !== undefined ? { note: by } : {}), updatedAt: now() });
  } else if (op === 'approve' || op === 'sendBack') {
    await approveStep(order.orderNumber, s.stepNo, op === 'approve', note, env);
    if (op === 'sendBack') await reopenLead(order, s, note, env);
  } else if (op === 'restart') {
    if (s.status === 'waiting') throw new ApiError('STEP_NOT_STARTED');
    await ref.update({ status: 'waiting', result: '', error: '', note: note ?? '', updatedAt: now() });
    // A finished order is open again while the step runs anew
    if (order.orderStatus === 'completed') {
      await db.doc('Orders/' + order.orderNumber).update({ orderStatus: 'in_progress', completedAt: null, updatedAt: now() });
    }
    await advance(order.orderNumber, env);
  } else if (op === 'skip') {
    if (['done', 'skipped'].includes(s.status)) throw new ApiError('STEP_ALREADY_DONE');
    await ref.update({ status: 'skipped', note: by, updatedAt: now() });
    await advance(order.orderNumber, env);
  } else {
    const changes = {};
    if (data.clientLabel !== undefined) {
      changes.clientLabel = cleanText(data.clientLabel, 120, 'INVALID_REQUEST');
      if (!changes.clientLabel) throw new ApiError('STEP_LABEL_REQUIRED');
    }
    if (data.lawyerTask !== undefined) changes.lawyerTask = cleanText(data.lawyerTask, 2000, 'INVALID_REQUEST');
    if (data.dueAt !== undefined) changes.dueAt = dueDate(data.dueAt);
    if (note !== undefined) changes.note = note;
    if (!Object.keys(changes).length) throw new ApiError('NOTHING_TO_CHANGE');
    await ref.update({ ...changes, updatedAt: now() });
  }
  return workspace({ orderNumber: order.orderNumber });
}

// A result sent back: the lead lawyer's assignment is open again, and they
// hear why
async function reopenLead(order, s, note, env) {
  const snap = await db.collection(`Orders/${order.orderNumber}/Assignments`).where('role', '==', 'lead').get();
  for (const d of snap.docs) {
    const a = d.data();
    if (a.status === 'cancelled') continue;
    await d.ref.update({ status: 'in_progress', completedAt: null });
    const lawyer = await lawyerById(a.lawyerId);
    if (!lawyer?.email) continue;
    await mail(env, {
      to: lawyer.email,
      subject: `Changes needed — ${order.orderNumber}`,
      text: [
        `Dear ${lawyer.firstName},`,
        '',
        `Your result for "${s.clientLabel}" (${order.serviceName}, order ${order.orderNumber}) needs changes before it goes to the client.`,
        note ? '\n' + note : '',
        '',
        'Open it in your Workspace: https://www.ailaw.llc/workspace',
        '',
        'AI Law LLC · www.ailaw.llc',
      ].join('\n'),
    });
  }
}

// ---------- Workflow and lawyers ----------

async function start(data, env) {
  const order = await requireOrder(data.orderNumber);
  if (!OPEN.includes(order.orderStatus)) throw new ApiError('ORDER_CLOSED');
  if ((await orderSteps(order.orderNumber)).length) throw new ApiError('WORKFLOW_ALREADY_RUNNING');
  await startWorkflow(order.orderNumber, env);
  if (!(await orderSteps(order.orderNumber)).length) throw new ApiError('SERVICE_HAS_NO_WORKFLOW');
  return workspace({ orderNumber: order.orderNumber });
}

async function unassign(data, env) {
  const order = await requireOrder(data.orderNumber);
  const ref = db.doc(`Orders/${order.orderNumber}/Assignments/${cleanKey(data.assignmentId, 'ASSIGNMENT_NOT_FOUND')}`);
  const a = (await ref.get()).data();
  if (!a || a.status === 'cancelled') throw new ApiError('ASSIGNMENT_NOT_FOUND');
  await ref.update({ status: 'cancelled', cancelledAt: now() });
  const lawyer = await lawyerById(a.lawyerId);
  if (lawyer?.email) {
    await mail(env, {
      to: lawyer.email,
      subject: `Assignment closed — ${order.orderNumber}`,
      text: [
        `Dear ${lawyer.firstName},`,
        '',
        `You are no longer assigned to order ${order.orderNumber} (${order.serviceName}). There is nothing more to do on it.`,
        '',
        'AI Law LLC · www.ailaw.llc',
      ].join('\n'),
    });
  }
  return workspace({ orderNumber: order.orderNumber });
}

// ---------- Admin chat tools ----------

const safe = (run) => async (ctx, args) => {
  try {
    return await run(ctx, args || {});
  } catch (err) {
    if (err instanceof ApiError) return { error: err.code };
    throw err;
  }
};
const str = (description) => ({ type: 'string', description });
const tool = (description, properties, required, run) => ({
  sides: ['admin'],
  description,
  parameters: { type: 'object', properties, ...(required.length ? { required } : {}) },
  run: safe(run),
});
const CHANGE = ' Shows a Confirm card; nothing changes until the admin confirms.';
const OP_TITLES = {
  complete: 'Complete step',
  correct: 'Correct the result of step',
  approve: 'Approve step',
  sendBack: 'Send back step',
  restart: 'Restart step',
  skip: 'Skip step',
  edit: 'Change step',
};

const tools = {
  order_workspace: tool(
    "An order's workspace: details, client, workflow steps (status, owner, deadline, result, error), lawyers, " +
      'documents (with Internal) and its history of admin changes.',
    { orderNumber: str('AIL-…') },
    ['orderNumber'],
    async (ctx, a) => {
      const w = await workspace(a);
      // Short enough for the chat: no file sizes, the latest history only
      return { ...w, history: w.history.slice(0, 15).map(({ changes, ...rest }) => rest) };
    },
  ),
  order_step: tool(
    'Proposes one change to a workflow step: complete (with a result), correct (a done step\'s result), approve or ' +
      'sendBack (a step in review, with a note why), restart, skip, or edit (clientLabel, lawyerTask, dueAt ' +
      'yyyy-MM-dd or empty to clear).' +
      CHANGE,
    {
      orderNumber: str('AIL-…'),
      stepNo: { type: 'number' },
      op: { type: 'string', enum: STEP_OPS },
      result: str('result text or link (complete, correct)'),
      note: str('optional'),
      clientLabel: str('edit only'),
      lawyerTask: str('edit only'),
      dueAt: str('edit only: yyyy-MM-dd, or empty to clear'),
    },
    ['orderNumber', 'stepNo', 'op'],
    async (ctx, a) => {
      const order = await requireOrder(a.orderNumber);
      const s = (await orderSteps(order.orderNumber)).find((x) => x.stepNo === Number(a.stepNo));
      if (!s) return { error: 'STEP_NOT_FOUND' };
      const data = { orderNumber: order.orderNumber, stepNo: s.stepNo, op: a.op };
      ['result', 'note', 'clientLabel', 'lawyerTask', 'dueAt'].forEach((k) => a[k] !== undefined && (data[k] = a[k]));
      const lines = [`${s.stepNo}. ${s.clientLabel} · now ${s.status}`];
      if (a.result) lines.push('Result: ' + a.result);
      if (a.note) lines.push('Note: ' + a.note);
      if (a.dueAt !== undefined) lines.push('Deadline: ' + (a.dueAt || 'none'));
      if (a.op === 'sendBack') lines.push('The lead lawyer is emailed that changes are needed.');
      return proposeAction(ctx, {
        action: 'order:step',
        data,
        title: `${OP_TITLES[a.op]} ${s.stepNo} of ${order.orderNumber}`,
        lines,
        danger: a.op === 'skip' || a.op === 'restart',
      });
    },
  ),
  order_edit: tool(
    "Proposes changing an order's details: customerName, customerEmail, customerPhone, customerNotes, billingAddress, " +
      'adminNotes (AI Law only), details (JSON object of the service\'s details), dueAt (yyyy-MM-dd, empty clears).' +
      CHANGE,
    {
      orderNumber: str('AIL-…'),
      customerName: str(''),
      customerEmail: str(''),
      customerPhone: str(''),
      customerNotes: str(''),
      billingAddress: str(''),
      adminNotes: str(''),
      details: str('JSON object'),
      dueAt: str(''),
    },
    ['orderNumber'],
    async (ctx, a) => {
      const order = await requireOrder(a.orderNumber);
      const data = { orderNumber: order.orderNumber };
      const lines = [];
      for (const key of [...Object.keys(EDITABLE), 'customerEmail', 'dueAt']) {
        if (a[key] === undefined) continue;
        data[key] = a[key];
        lines.push(`${key}: ${order[key] ?? '—'} → ${a[key] || '—'}`);
      }
      if (a.details !== undefined) {
        try {
          data.details = JSON.parse(a.details);
        } catch {
          return { error: 'INVALID_DETAILS_JSON' };
        }
        lines.push('details: ' + a.details);
      }
      if (!lines.length) return { error: 'NOTHING_TO_CHANGE' };
      return proposeAction(ctx, { action: 'order:edit', data, title: `Change order ${order.orderNumber}`, lines });
    },
  ),
  order_prices: tool(
    "Proposes new line prices and/or discounts on an unpaid order (orderItemId from order_workspace); the totals follow. " +
      'Remake the agreement afterwards.' +
      CHANGE,
    {
      orderNumber: str('AIL-…'),
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: { orderItemId: { type: 'string' }, unitPrice: { type: 'number' }, discountAmount: { type: 'number' } },
          required: ['orderItemId'],
        },
      },
    },
    ['orderNumber', 'items'],
    async (ctx, a) => {
      const order = await requireOrder(a.orderNumber);
      const items = await orderItems(order.orderNumber);
      const lines = (a.items || []).map((w) => {
        const i = items.find((x) => x.id === w.orderItemId);
        return i
          ? `${i.name}: ${i.unitPrice} → ${w.unitPrice ?? i.unitPrice}${w.discountAmount !== undefined ? `, discount ${w.discountAmount}` : ''}`
          : `${w.orderItemId}: not on this order`;
      });
      return proposeAction(ctx, { action: 'order:prices', data: { orderNumber: order.orderNumber, items: a.items || [] }, title: `New prices on ${order.orderNumber}`, lines });
    },
  ),
  order_start_workflow: tool(
    "Proposes starting the service's workflow on an order that has no steps yet." + CHANGE,
    { orderNumber: str('AIL-…') },
    ['orderNumber'],
    async (ctx, a) => {
      const order = await requireOrder(a.orderNumber);
      return proposeAction(ctx, { action: 'order:startWorkflow', data: { orderNumber: order.orderNumber }, title: `Start the workflow of ${order.orderNumber}`, lines: [order.serviceName] });
    },
  ),
  order_unassign: tool(
    'Proposes taking a lawyer off an order (assignmentId from order_workspace); they are emailed. To reassign, ' +
      'then assign the new lawyer.' +
      CHANGE,
    { orderNumber: str('AIL-…'), assignmentId: str('AS-…') },
    ['orderNumber', 'assignmentId'],
    async (ctx, a) => {
      const order = await requireOrder(a.orderNumber);
      const snap = await db.doc(`Orders/${order.orderNumber}/Assignments/${cleanKey(a.assignmentId, 'ASSIGNMENT_NOT_FOUND')}`).get();
      if (!snap.exists) return { error: 'ASSIGNMENT_NOT_FOUND' };
      const as = snap.data();
      return proposeAction(ctx, {
        action: 'order:unassign',
        data: { orderNumber: order.orderNumber, assignmentId: snap.id },
        title: `Take ${as.lawyerName} off ${order.orderNumber}`,
        lines: [`${as.role} · ${as.status}`],
        danger: true,
      });
    },
  ),
};

export default {
  id: 'order-desk',
  sides: ['admin'],
  actions: {
    admin: {
      'order:get': (caller, data) => workspace(data),
      'order:edit': (caller, data) => edit(data),
      'order:prices': (caller, data) => prices(data),
      'order:step': (caller, data, env) => step(caller, data, env),
      'order:startWorkflow': (caller, data, env) => start(data, env),
      'order:unassign': (caller, data, env) => unassign(data, env),
    },
  },
  tools,
};
