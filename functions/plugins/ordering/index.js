// ==========================================================
// Plugin: ordering (client)
//   placeOrder   checkout from the cart the browser keeps: { items: [{ slug, quantity }] }
//   start_order  the chat's tool: one service, with the details the client
//                confirmed; the order then runs its plugin's steps
// After every order (setupOrder, retried by the daily job when it fails):
//   1. its Storage folder: the client's folder/2026/…, or guests/2026/…
//   2. the Legal Services Agreement PDF (+ invoice page when paying by invoice)
//   3. the confirmation email with the PDF attached
// sendReceipt is used by the on-paid job.
// ==========================================================

import { ApiError, COMPANY, cleanName, db, formatDate, log, now, parseJson, validEmail } from '../../core/app.js';
import { addPart } from '../../core/chat.js';
import { buildPdf, join, makeFolder, readFile, saveFile } from '../../core/files.js';
import { pluginRecords } from '../../core/loader.js';
import { createOrder, orderCard, paymentInfo } from '../../core/orders.js';
import { chatSettings, clientById, orderByNumber, orderItems, serviceBySlug } from '../../core/records.js';
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

  // 1. Folder
  if (!order.folder) {
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
  if (!order.agreement) {
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

export default {
  id: 'ordering',
  sides: ['client'],
  actions: {
    client: {
      placeOrder: (caller, data, env) => placeOrder(caller, data, env),
    },
  },
  tools: { start_order: startOrder },
};
