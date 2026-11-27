// ==========================================================
// Plugin: ordering (client + admin)
// Client:
//   placeOrder   checkout from the cart the browser keeps: { items: [{ slug, quantity }] }
//   start_order  the chat's tool: one service, with the details the client
//                confirmed; the order then runs its plugin's steps
// Admin:
//   admin:createOrder      an order taken by phone or Telegram, for an
//                          existing client or a new guest
//   admin:remakeAgreement  a fresh PDF from the order as it is now
//   admin:resendEmail      the confirmation email again
// After every order (setupOrder, retried by the daily job when it fails):
//   1. its Storage folder: the client's folder/2026/…, or guests/2026/…
//   2. the Legal Services Agreement PDF (+ invoice page when paying by invoice)
//   3. the confirmation email with the PDF attached
// sendReceipt is used by the on-paid job.
// ==========================================================

import {
  ApiError,
  COMPANY,
  cleanKey,
  cleanName,
  cleanText,
  db,
  formatDate,
  log,
  newCode,
  now,
  parseJson,
  titleCase,
  validEmail,
} from '../../core/app.js';
import { addPart } from '../../core/chat.js';
import { buildPdf, join, makeFolder, readFile, saveFile } from '../../core/files.js';
import { pluginRecords } from '../../core/loader.js';
import { createOrder, orderCard, paymentInfo, toOrder } from '../../core/orders.js';
import {
  chatSettings,
  clientByEmail,
  clientById,
  orderById,
  orderByNumber,
  orderItems,
  serviceBySlug,
} from '../../core/records.js';
import { mail, startSteps } from '../../core/steps.js';
import { agreementBlocks, agreementData, invoiceBlocks } from './agreement.js';

// ---------- After an order ----------

export async function setupOrder(orderNumber, env) {
  const order = await orderByNumber(orderNumber);
  if (!order) return;
  const ref = db.doc('Orders/' + orderNumber);

  if (!validEmail(order.customerEmail)) {
    await log('setup ' + orderNumber, 'CustomerEmail is missing or invalid');
    return;
  }

  // 1. Folder (orders copied from Drive get a new one in Storage)
  if (!order.folder || order.folder.startsWith('drive:')) {
    const client = await clientById(order.clientId);
    const year = formatDate(order.createdAt, 'yyyy');
    const stamp = formatDate(order.createdAt, 'yyyy-MM-dd_HH-mm-ss');
    const service = cleanName(order.serviceName);
    order.folder =
      client?.folder && !client.folder.startsWith('drive:') && client.type !== 'guest'
        ? join(client.folder, year, `${stamp} - ${service}`)
        : join('guests', year, `${stamp} - ${service} - ${order.clientId}${order.customerName ? ' - ' + cleanName(order.customerName) : ''}`);
    await makeFolder(order.folder);
    await ref.update({ folder: order.folder, updatedAt: now() });
  }

  // 2. Agreement
  if (!order.agreement || order.agreement.startsWith('drive:')) {
    const d = await documentData(order);
    const withInvoice = d.paymentMethod === 'invoice';
    const title = (withInvoice ? 'Legal Services Agreement and Invoice - ' : 'Legal Services Agreement - ') + d.number;
    const pdf = await buildPdf([...agreementBlocks(d), ...(withInvoice ? invoiceBlocks(d) : [])]);
    order.agreement = await saveFile(join(order.folder, title + '.pdf'), pdf, 'application/pdf');
    await ref.update({ agreement: order.agreement, updatedAt: now() });
  }

  // 3. Confirmation email
  if (!order.emailedAt) {
    const sent = await sendConfirmation(order, env);
    if (sent) await ref.update({ emailedAt: now(), updatedAt: now() });
  }
}

async function documentData(order) {
  const bank = await chatSettings();
  return agreementData(order, await orderItems(order.orderNumber), {
    recipient: bank.BankRecipient || COMPANY.name,
    iban: bank.BankIban || '',
  });
}

async function sendConfirmation(order, env) {
  const d = await documentData(order);
  const invoice = d.paymentMethod === 'invoice';
  const services = d.lines.map((l) => `• ${l.name}${l.quantity > 1 ? ' × ' + l.quantity : ''} — ${l.total} ${d.currency}`).join('\n');
  const payment = invoice
    ? `Payment: please transfer ${d.total} ${d.currency} to\n${d.bank.recipient}, IBAN ${d.bank.iban}\n` +
      `with the reference ${d.number}. The invoice is on the second page of the attached PDF.\n` +
      'We start as soon as the payment arrives.'
    : 'Payment: received at checkout. We are starting on your order.';
  const file = order.agreement.startsWith('drive:') ? null : await readFile(order.agreement);

  return mail(env, {
    to: order.customerEmail,
    subject: `Your order ${d.number} — AI Law`,
    text: [
      d.client.name ? `Dear ${d.client.name},` : 'Hello,',
      '',
      `Thank you for your order ${d.number}.`,
      '',
      services,
      `Total: ${d.total} ${d.currency}`,
      '',
      payment,
      '',
      `Attached is your Legal Services Agreement${invoice ? ' with the invoice' : ''}.`,
      d.client.code ? `Your client code: ${d.client.code}.` : '',
      '',
      'Questions? Just reply to this email.',
      '',
      `AI Law LLC · ${COMPANY.website}`,
    ]
      .filter((line, i, all) => line !== '' || all[i - 1] !== '')
      .join('\n'),
    attachments: file
      ? [{ filename: order.agreement.split('/').pop(), content: file.content, contentType: 'application/pdf' }]
      : [],
  });
}

// The receipt, once an order is paid
export async function sendReceipt(order, env) {
  const d = await documentData(order);
  return mail(env, {
    to: order.customerEmail,
    subject: `Payment received — order ${d.number}`,
    text: [
      d.client.name ? `Dear ${d.client.name},` : 'Hello,',
      '',
      `We have received your payment for order ${d.number}.`,
      '',
      `Amount: ${d.total} ${d.currency}`,
      `Date: ${formatDate(order.paidAt, 'dd.MM.yyyy')}`,
      'Services:',
      d.lines.map((l) => `• ${l.name}${l.quantity > 1 ? ' × ' + l.quantity : ''}`).join('\n'),
      '',
      'We have started working on your order and will send the results to this email.',
      '',
      'Questions? Just reply to this email.',
      '',
      `AI Law LLC · ${COMPANY.website}`,
    ].join('\n'),
  });
}

// A failed setup must not cancel the order: the daily job retries it
async function setupSafely(orderNumber, env) {
  try {
    await setupOrder(orderNumber, env);
  } catch (err) {
    await log('setup ' + orderNumber, err);
  }
}

// ---------- Client ----------

async function placeOrder(caller, data, env) {
  const items = Array.isArray(data.items) ? data.items : [];
  const { order } = await createOrder(caller, items, {
    customerName: data.customerName,
    customerPhone: data.customerPhone,
    billingAddress: data.billingAddress,
    customerNotes: data.customerNotes,
  });
  await setupSafely(order.orderNumber, env);
  return paymentInfo(order);
}

// Checks the AI's details against the plugin's fields
function checkDetails(fields, details) {
  const data = {};
  for (const f of fields) {
    const raw = details[f.field];
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      if (f.required) throw new ApiError('MISSING_' + String(f.field).toUpperCase());
      continue;
    }
    let value = String(raw).trim();
    if (f.type === 'number') {
      value = Number(value.replace(',', '.').replace(/\s/g, ''));
      if (!Number.isFinite(value) || value < 0) throw new ApiError('INVALID_' + String(f.field).toUpperCase());
    } else if (f.type === 'month' && !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
      throw new ApiError('INVALID_' + String(f.field).toUpperCase());
    }
    data[f.field] = value;
  }
  return data;
}

const startOrder = {
  sides: ['client'],
  description:
    'Place an order for a service, after the client confirmed all details. ' +
    'Returns the order number, payment instructions and any calculated values (e.g. tax).',
  parameters: {
    type: 'object',
    properties: {
      service_id: { type: 'string' },
      details: {
        type: 'string',
        description: 'The confirmed details as a JSON object keyed by field name, e.g. {"period":"2026-10","income":"1500"}',
      },
    },
    required: ['service_id', 'details'],
  },
  run: async (ctx, args) => {
    if (!ctx.caller.signedIn) return { error: 'SIGN_IN_REQUIRED' };
    const service = await serviceBySlug(String(args.service_id || ''));
    if (!service) throw new ApiError('SERVICE_NOT_FOUND');
    const plugin = (await pluginRecords())[service.plugin] || {};
    const details = checkDetails(plugin.fields || [], parseJson(args.details, {}));

    let placed;
    try {
      placed = await createOrder(ctx.caller, [{ slug: service.serviceId, quantity: 1 }], {
        source: 'chat',
        conversationId: ctx.conversationId,
        details,
      });
    } catch (err) {
      if (err.code === 'VERIFICATION_REQUIRED') {
        return {
          error: 'VERIFICATION_REQUIRED',
          instruction: `This service is only for verified clients. Ask the client to contact ${COMPANY.verifyContact} to get verified; after that they can order it here.`,
        };
      }
      throw err;
    }
    const { order } = placed;
    await setupSafely(order.orderNumber, ctx.env);
    await startSteps(order.orderNumber, plugin.steps || [], ctx.env);

    const current = await orderByNumber(order.orderNumber);
    addPart(ctx, await orderCard(order.orderNumber));
    addPart(ctx, { type: 'payment', amount: Number(current.total), currency: current.currency, reference: current.orderNumber });
    return {
      orderId: current.orderNumber,
      price: `${current.total} ${current.currency}`,
      details: current.details,
      payment: 'Shown to the client in a card under your answer (bank transfer, order number as reference).',
    };
  },
};

// ---------- Admin ----------

// The client an admin order is for: an existing one by code, or a new guest
// (a guest with that email already on file is reused)
async function orderClient(data) {
  if (data.clientId) {
    const client = await clientById(cleanKey(data.clientId));
    if (!client) throw new ApiError('CLIENT_NOT_FOUND');
    return client;
  }
  const guest = data.guest || {};
  const email = String(guest.email || '').trim().toLowerCase();
  if (!validEmail(email)) throw new ApiError('INVALID_EMAIL');
  const known = await clientByEmail(email);
  if (known) return known;

  const firstName = titleCase(cleanText(guest.firstName, 80));
  const lastName = titleCase(cleanText(guest.lastName, 80));
  if (!firstName) throw new ApiError('MISSING_NAME');
  const clientId = await newCode('ID', 'Clients');
  const record = {
    clientId,
    type: 'guest',
    status: 'active',
    firstName,
    lastName,
    displayName: [firstName, lastName].filter(Boolean).join(' '),
    email,
    phone: cleanText(guest.phone, 30),
    passport: '',
    idNumber: '',
    address: '',
    notes: '',
    userId: '',
    role: 'client',
    providers: [],
    emailVerified: false,
    photoUrl: '',
    folder: '',
    createdAt: now(),
    updatedAt: now(),
    lastLoginAt: null,
  };
  await db.doc('Clients/' + clientId).set(record);
  return { id: clientId, ...record };
}

async function adminCreateOrder(caller, data, env) {
  const client = await orderClient(data);
  if (!validEmail(client.email)) throw new ApiError('CLIENT_HAS_NO_EMAIL');
  const paid = data.payment === 'paid';
  const { order } = await createOrder(caller, Array.isArray(data.items) ? data.items : [], {
    client,
    source: 'manual',
    customerNotes: data.customerNotes,
    paymentMethod: paid ? 'checkout' : 'invoice',
  });
  await setupSafely(order.orderNumber, env);
  // Already paid: the on-paid job sends the receipt and starts the work
  if (paid) await db.doc('Orders/' + order.orderNumber).update({ paymentStatus: 'paid', updatedAt: now() });
  return toOrder(await orderByNumber(order.orderNumber), await orderItems(order.orderNumber));
}

async function adminOrder(data) {
  const order = await orderById(cleanKey(data.orderId));
  if (!order) throw new ApiError('ORDER_NOT_FOUND');
  return order;
}

// The agreement is made again from the order's current details (same file name)
async function remakeAgreement(caller, data, env) {
  const order = await adminOrder(data);
  await db.doc('Orders/' + order.orderNumber).update({ agreement: '', updatedAt: now() });
  await setupOrder(order.orderNumber, env);
  const fresh = await orderByNumber(order.orderNumber);
  if (!fresh.agreement) throw new ApiError('AGREEMENT_FAILED');
  return toOrder(fresh, await orderItems(order.orderNumber));
}

async function resendEmail(caller, data, env) {
  const order = await adminOrder(data);
  await db.doc('Orders/' + order.orderNumber).update({ emailedAt: null, updatedAt: now() });
  await setupOrder(order.orderNumber, env);
  const fresh = await orderByNumber(order.orderNumber);
  if (!fresh.emailedAt) throw new ApiError('EMAIL_FAILED');
  return toOrder(fresh, await orderItems(order.orderNumber));
}

export default {
  id: 'ordering',
  sides: ['client', 'admin'],
  actions: {
    client: {
      placeOrder: (caller, data, env) => placeOrder(caller, data, env),
    },
    admin: {
      'admin:createOrder': (caller, data, env) => adminCreateOrder(caller, data, env),
      'admin:remakeAgreement': (caller, data, env) => remakeAgreement(caller, data, env),
      'admin:resendEmail': (caller, data, env) => resendEmail(caller, data, env),
    },
  },
  tools: { start_order: startOrder },
};
