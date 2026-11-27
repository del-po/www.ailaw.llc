// ==========================================================
// Core: the step runner
// An order made from a plugin gets its own copy of the plugin's steps
// (Orders/{AIL-…}/Steps), so later edits to the plugin don't change orders
// already running. advance() runs the steps in order until one has to wait:
//   - for the payment (await_payment)
//   - for a lawyer (owner "lawyer": it waits in the admin's task desk)
// or until the last step is done, which completes the order.
//
// Step types (capabilities) built into the core:
//   collect        the details were gathered in the chat before ordering
//   calculate      config { base, rate, output }: e.g. 1% of income → tax
//   await_payment  waits until the order is marked paid
//   task           work for a lawyer (owner "lawyer")
//   deliver        sends the results to the client (chat + email)
// Plugins may add their own with registerCapabilities().
// ==========================================================

import { ApiError, db, log, now, parseJson } from './app.js';
import { orderByNumber, orderSteps, setting } from './records.js';
import { readFile } from './files.js';
import { sendMail } from './send.js';

const capabilities = {};

export function registerCapabilities(list) {
  Object.assign(capabilities, list);
}

const isUrl = (v) => /^https?:\/\/\S+$/.test(String(v || ''));
// A step's result can also be a file in Storage: "file:<path>"
const isFile = (v) => String(v || '').startsWith('file:');
const pad = (n) => String(n).padStart(2, '0');

// Copies the plugin's steps into the order, then runs them
export async function startSteps(orderNumber, steps, env) {
  if (!steps?.length) return;
  const batch = db.batch();
  steps
    .slice()
    .sort((a, b) => a.stepNo - b.stepNo)
    .forEach((s) => {
      batch.set(db.doc(`Orders/${orderNumber}/Steps/${pad(s.stepNo)}`), {
        stepNo: Number(s.stepNo),
        stepId: s.stepId || '',
        owner: s.owner || 'chat',
        capability: s.capability || '',
        clientLabel: s.clientLabel || '',
        lawyerTask: s.lawyerTask || '',
        config: parseJson(s.config, {}),
        status: 'waiting',
        result: '',
        note: '',
        updatedAt: now(),
      });
    });
  await batch.commit();
  await advance(orderNumber, env);
}

export async function advance(orderNumber, env) {
  const order = await orderByNumber(orderNumber);
  if (!order || order.orderStatus === 'cancelled') return;
  const steps = await orderSteps(orderNumber);
  if (!steps.length) return;
  const stepRef = (s) => db.doc(`Orders/${orderNumber}/Steps/${s.id}`);

  for (const step of steps) {
    if (step.status === 'done') continue;

    if (step.owner === 'lawyer') {
      if (step.status !== 'active') {
        await stepRef(step).update({ status: 'active', updatedAt: now() });
        await notifyLawyer(order, step, env);
      }
      return;
    }

    const capability = capabilities[step.capability];
    if (!capability) throw new ApiError('UNKNOWN_CAPABILITY');
    const result = (await capability({ order, step, steps, config: step.config || {}, env })) || '';

    // A step that has to wait stays active and stops the run here
    if (result && typeof result === 'object' && result.wait) {
      if (step.status !== 'active') await stepRef(step).update({ status: 'active', updatedAt: now() });
      return;
    }
    await stepRef(step).update({ status: 'done', result: String(result), updatedAt: now() });
    step.status = 'done';
    step.result = String(result);
  }

  await db.doc('Orders/' + orderNumber).update({
    orderStatus: 'completed',
    completedAt: now(),
    updatedAt: now(),
  });
}

// Orders waiting for payment move on once paid (also run by the daily job)
export async function resumePaid(env) {
  const waiting = await db
    .collectionGroup('Steps')
    .where('capability', '==', 'await_payment')
    .where('status', '==', 'active')
    .get();
  for (const doc of waiting.docs) {
    const orderNumber = doc.ref.parent.parent.id;
    const order = await orderByNumber(orderNumber);
    if (order?.paymentStatus !== 'paid') continue;
    try {
      await advance(orderNumber, env);
    } catch (err) {
      await log('resume ' + orderNumber, err);
    }
  }
}

// A lawyer step done: its result (a link when the step needs a file) is
// saved and the order goes on
export async function completeStep(orderNumber, stepNo, result, note, env) {
  const steps = await orderSteps(orderNumber);
  const step = steps.find((s) => s.stepNo === Number(stepNo));
  if (!step || step.owner !== 'lawyer' || step.status !== 'active') throw new ApiError('NOT_FOUND');
  const text = String(result || '').trim();
  if (step.config?.needsFile && !isUrl(text) && !isFile(text)) throw new ApiError('FILE_LINK_REQUIRED');
  await db.doc(`Orders/${orderNumber}/Steps/${step.id}`).update({
    status: 'done',
    result: text,
    note: String(note || '').trim(),
    updatedAt: now(),
  });
  await advance(orderNumber, env);
}

// ---------- Email helper ----------

// Sends, and logs instead of failing: a missed email must not break the order
export async function mail(env, message) {
  try {
    return await sendMail(message, env.secrets);
  } catch (err) {
    await log('email ' + message.subject, err);
    return null;
  }
}

async function notifyLawyer(order, step, env) {
  const to = (await setting('chat')).values?.LawyerEmail;
  if (!to || !env) return;
  await mail(env, {
    to,
    subject: `AI Law task: ${step.clientLabel} — ${order.orderNumber}`,
    text: [
      `${order.serviceName} — ${order.orderNumber}`,
      `Client: ${order.customerName || ''} <${order.customerEmail}>`,
      `Details: ${JSON.stringify(order.details || {})}`,
      '',
      `Task: ${step.lawyerTask}`,
      '',
      'Open www.ailaw.llc/admin/review to mark it done.',
    ].join('\n'),
  });
}

// ---------- The core step types ----------

registerCapabilities({
  collect: () => 'Details received',

  await_payment: ({ order }) => (order.paymentStatus === 'paid' ? 'Paid' : { wait: true }),

  calculate: async ({ order, config }) => {
    const details = { ...(order.details || {}) };
    const value = Math.round(Number(details[config.base] || 0) * Number(config.rate) * 100) / 100;
    details[config.output] = value;
    order.details = details;
    await db.doc('Orders/' + order.orderNumber).update({ details, updatedAt: now() });
    return `${config.output} = ${value}`;
  },

  // Every result of earlier steps goes to the client: links in the chat where
  // they ordered and in the email (config.email); files attached to the
  // email, and already in their Documents page
  deliver: async ({ order, steps, config, env }) => {
    const done = steps.filter((s) => s.status === 'done');
    const links = done.filter((s) => isUrl(s.result)).map((s) => s.result);
    const files = done.filter((s) => isFile(s.result)).map((s) => s.result.slice(5));
    const text =
      `Your order **${order.orderNumber}** (${order.serviceName}) is complete.` +
      (links.length ? '\n\n' + links.map((l, i) => `[Document ${i + 1}](${l})`).join('\n') : '') +
      (files.length ? '\n\nThe documents are in your account, under Documents.' : '');

    if (order.conversationId) {
      const chat = db.doc('Chat/' + order.conversationId);
      if ((await chat.get()).exists) {
        await chat.collection('Messages').add({ role: 'assistant', text, parts: [], deleted: false, createdAt: now() });
        await chat.update({ updatedAt: now() });
      }
    }
    if (config.email && order.customerEmail) {
      const attachments = [];
      for (const path of files) {
        const file = await readFile(path);
        if (file) attachments.push({ filename: path.split('/').pop(), content: file.content, contentType: file.contentType });
      }
      await mail(env, {
        to: order.customerEmail,
        subject: `AI Law — ${order.serviceName} (${order.orderNumber})`,
        text:
          text.replace(/\*\*/g, '').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1: $2') +
          '\n\nAI Law LLC · www.ailaw.llc',
        attachments,
      });
    }
    return 'Delivered';
  },
});
