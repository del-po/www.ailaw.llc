// ==========================================================
// Plugin: my orders (client)
//   getOrders, getOrder   the profile's Orders page
//   orders:list           orders with steps (from the chat), with progress
//   get_my_orders         the chat's tool: progress in plain words + cards
// A client only ever sees their own orders.
// ==========================================================

import { ApiError, cleanKey, db, toDate } from '../../core/app.js';
import { addPart } from '../../core/chat.js';
import { orderCard, toOrder } from '../../core/orders.js';
import { docs, orderById, orderItems, orderSteps } from '../../core/records.js';
import { resumePaid } from '../../core/steps.js';

const isUrl = (v) => /^https?:\/\/\S+$/.test(String(v || ''));

async function myOrders(caller) {
  const snap = await db.collection('Orders').where('userId', '==', caller.uid).get();
  return docs(snap).sort((a, b) => (toDate(b.createdAt) || 0) - (toDate(a.createdAt) || 0));
}

async function getOrder(caller, data) {
  const order = await orderById(cleanKey(data.orderId));
  if (!order || order.userId !== caller.uid) throw new ApiError('ORDER_NOT_FOUND');
  return toOrder(order, await orderItems(order.orderNumber));
}

// Orders with steps, newest first; placed and in_progress both show as in progress
async function listWithSteps(caller, env) {
  if (!caller.signedIn) return [];
  await resumePaid(env);
  const result = [];
  for (const o of await myOrders(caller)) {
    const steps = await orderSteps(o.orderNumber);
    if (!steps.length) continue;
    const done = o.orderStatus === 'completed';
    result.push({
      orderId: o.orderNumber,
      title: o.serviceName,
      status: done || o.orderStatus === 'cancelled' ? o.orderStatus : 'in_progress',
      price: Number(o.total),
      currency: o.currency,
      createdAt: toDate(o.createdAt)?.getTime() || 0,
      details: o.details || {},
      steps: steps.map((s) => ({ label: s.clientLabel, status: s.status === 'active' ? 'in_progress' : s.status })),
      files: done ? steps.map((s) => s.result).filter(isUrl) : [],
    });
  }
  return result;
}

export default {
  id: 'my-orders',
  sides: ['client'],
  actions: {
    client: {
      getOrders: async (caller) => (await myOrders(caller)).slice(0, 100).map((o) => toOrder(o)),
      getOrder: (caller, data) => getOrder(caller, data),
      'orders:list': { guest: true, run: (caller, data, env) => listWithSteps(caller, env) },
    },
  },
  tools: {
    get_my_orders: {
      sides: ['client'],
      description: "The signed-in client's orders with the progress of each.",
      run: async (ctx) => {
        if (!ctx.caller.signedIn) return { error: 'SIGN_IN_REQUIRED' };
        const orders = await listWithSteps(ctx.caller, ctx.env);
        for (const o of orders.filter((o) => o.status !== 'completed').slice(0, 3)) {
          addPart(ctx, await orderCard(o.orderId));
        }
        return orders.slice(0, 10).map((o) => ({
          orderId: o.orderId,
          service: o.title,
          status: o.status,
          steps: o.steps.map((s) => `${s.label}: ${s.status}`).join('; '),
        }));
      },
    },
  },
};
