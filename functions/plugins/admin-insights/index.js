// ==========================================================
// Plugin: admin insights (admin)
// The business at a glance, and what happened on the platform:
//   admin:dashboard  clients, orders, revenue, outstanding payments, services,
//                    lawyers, tasks waiting, stuck steps, errors, chat use,
//                    recent activity, and day-by-day figures for the charts
//   admin:audit      the audit log (core/audit.js): who changed what, when,
//                    from the panel or the chat
//   admin:logs       failed jobs and requests (Logs, written by core/app.js log())
// Dates come as "yyyy-MM-dd" (Tbilisi days); the default is the last 30 days.
// Website traffic and AI spending aren't counted anywhere yet: they come
// back as null until they are.
// The same three answers are the admin chat's tools below.
// ==========================================================

import { ApiError, db, formatDate, iso, toDate } from '../../core/app.js';
import { docs } from '../../core/records.js';

// A step still active after this many days counts as stuck (as does a
// failed step, or one past its deadline)
const STUCK_DAYS = 3;
const DAY = 24 * 60 * 60 * 1000;
// Longer periods are charted by month instead of by day
const MAX_DAYS_BY_DAY = 92;
// Figures in the charts are in the main currency; others only in the totals
const MAIN_CURRENCY = 'GEL';

// ---------- Period ----------

const DAY_TEXT = /^\d{4}-\d{2}-\d{2}$/;

// { from, to } as Dates covering whole Tbilisi days, plus the day texts
function period(data = {}) {
  const today = formatDate(new Date());
  const to = DAY_TEXT.test(data.to || '') ? data.to : today;
  const from = DAY_TEXT.test(data.from || '') ? data.from : formatDate(new Date(Date.now() - 29 * DAY));
  if (from > to) throw new ApiError('INVALID_PERIOD');
  return {
    fromDay: from,
    toDay: to,
    from: new Date(from + 'T00:00:00+04:00'),
    to: new Date(to + 'T23:59:59.999+04:00'),
  };
}

const within = (value, p) => {
  const date = toDate(value);
  return !!date && date >= p.from && date <= p.to;
};

const round = (n) => Math.round(Number(n || 0) * 100) / 100;

// { GEL: 120, USD: 40 } from orders
function sumByCurrency(orders) {
  const sums = {};
  orders.forEach((o) => {
    const cur = o.currency || MAIN_CURRENCY;
    sums[cur] = round((sums[cur] || 0) + Number(o.total || 0));
  });
  return sums;
}

// ---------- Dashboard ----------

async function dashboard(data) {
  const p = period(data);
  const [clientSnap, orderSnap, serviceSnap, staffSnap, stepSnap, logSnap, usageSnap, auditSnap] = await Promise.all([
    db.collection('Clients').get(),
    db.collection('Orders').get(),
    db.collection('Services').get(),
    db.collection('Staff').get(),
    db.collectionGroup('Steps').where('owner', 'in', ['chat', 'lawyer']).where('status', 'in', ['active', 'review', 'failed']).get(),
    db.collection('Logs').where('time', '>=', p.from).where('time', '<=', p.to).orderBy('time', 'desc').get(),
    db.collection('Usage').where('date', '>=', p.fromDay).where('date', '<=', p.toDay).get(),
    db.collection('AuditLog').orderBy('time', 'desc').limit(10).get(),
  ]);

  // Clients (merged records are gone into another one)
  const clients = docs(clientSnap).filter((c) => c.status !== 'merged');
  const current = clients.filter((c) => c.status !== 'deleted');
  const byType = { user: 0, verified: 0, guest: 0 };
  current.forEach((c) => (byType[c.type] = (byType[c.type] || 0) + 1));

  // Orders
  const orders = docs(orderSnap);
  const byStatus = { placed: 0, in_progress: 0, completed: 0, cancelled: 0 };
  orders.forEach((o) => (byStatus[o.orderStatus] = (byStatus[o.orderStatus] || 0) + 1));
  const paidInPeriod = orders.filter((o) => o.paymentStatus === 'paid' && within(o.paidAt, p));
  const outstanding = orders.filter((o) => o.paymentStatus === 'unpaid' && o.orderStatus !== 'cancelled');

  // Work: lawyer steps waiting, and steps that failed, passed their deadline
  // or have sat still too long (waiting for a payment doesn't count)
  const orderOf = Object.fromEntries(orders.map((o) => [o.id, o]));
  const open = stepSnap.docs
    .map((d) => ({ ...d.data(), orderNumber: d.ref.parent.parent.id }))
    .filter((s) => ['placed', 'in_progress'].includes(orderOf[s.orderNumber]?.orderStatus));
  const stuckBefore = Date.now() - STUCK_DAYS * DAY;
  const why = (s) => {
    if (s.status === 'failed') return 'failed';
    if (s.dueAt && toDate(s.dueAt) < new Date()) return 'late';
    if (s.capability !== 'await_payment' && (toDate(s.updatedAt)?.getTime() || 0) < stuckBefore) return 'still';
    return '';
  };
  const stuck = open
    .filter((s) => why(s))
    .map((s) => ({
      orderNumber: s.orderNumber,
      service: orderOf[s.orderNumber]?.serviceName || '',
      step: s.clientLabel || s.lawyerTask || s.capability,
      owner: s.owner,
      since: iso(s.updatedAt),
      reason: why(s),
    }))
    .sort((a, b) => a.since.localeCompare(b.since));

  const lawyers = docs(staffSnap);
  const logs = docs(logSnap);

  return {
    period: { from: p.fromDay, to: p.toDay },
    clients: {
      total: current.length,
      ...byType,
      suspended: current.filter((c) => c.status === 'suspended').length,
      new: clients.filter((c) => within(c.createdAt, p)).length,
    },
    orders: {
      total: orders.length,
      byStatus,
      new: orders.filter((o) => within(o.createdAt, p)).length,
    },
    revenue: sumByCurrency(paidInPeriod),
    outstanding: { count: outstanding.length, amounts: sumByCurrency(outstanding) },
    services: {
      active: docs(serviceSnap).filter((s) => s.status === 'active').length,
      total: docs(serviceSnap).length,
    },
    lawyers: {
      active: lawyers.filter((l) => ['approved', 'active'].includes(l.status)).length,
      applications: lawyers.filter((l) => l.status === 'applied').length,
    },
    tasksWaiting: open.filter((s) => s.owner === 'lawyer' && s.status === 'active').length,
    toApprove: open.filter((s) => s.status === 'review').length,
    stuck: { days: STUCK_DAYS, count: stuck.length, list: stuck.slice(0, 20) },
    errors: {
      count: logs.length,
      latest: logs.slice(0, 5).map((l) => ({ time: iso(l.time), action: l.action, error: l.error })),
    },
    // Questions asked in the chat (admins are not counted, see core/guard.js)
    chat: { questions: docs(usageSnap).reduce((n, u) => n + Number(u.count || 0), 0) },
    aiSpending: null,
    traffic: null,
    recent: docs(auditSnap).map(auditRow),
    series: series(orders, p),
  };
}

// Orders placed and revenue received, per day (or per month for long periods)
function series(orders, p) {
  const days = Math.round((p.to - p.from) / DAY);
  const byMonth = days > MAX_DAYS_BY_DAY;
  const keyOf = (date) => formatDate(date, byMonth ? 'yyyy-MM' : 'yyyy-MM-dd');

  const buckets = new Map();
  for (let t = p.from.getTime(); t <= p.to.getTime(); t += DAY) {
    const key = keyOf(new Date(t));
    if (!buckets.has(key)) buckets.set(key, { key, orders: 0, revenue: 0 });
  }
  orders.forEach((o) => {
    if (within(o.createdAt, p)) {
      const b = buckets.get(keyOf(toDate(o.createdAt)));
      if (b) b.orders += 1;
    }
    if (o.paymentStatus === 'paid' && within(o.paidAt, p) && (o.currency || MAIN_CURRENCY) === MAIN_CURRENCY) {
      const b = buckets.get(keyOf(toDate(o.paidAt)));
      if (b) b.revenue = round(b.revenue + Number(o.total || 0));
    }
  });
  return { unit: byMonth ? 'month' : 'day', currency: MAIN_CURRENCY, points: [...buckets.values()] };
}

// ---------- Audit log ----------

function auditRow(a) {
  return {
    id: a.id,
    time: iso(a.time),
    who: a.name || a.email || a.uid,
    email: a.email || '',
    via: a.via || 'panel',
    action: a.action,
    target: a.target || null,
    changes: a.changes || null,
    data: a.data || null,
    ok: a.ok !== false,
    error: a.error || '',
  };
}

const words = (q) => String(q || '').toLowerCase().split(/\s+/).filter(Boolean);

async function auditLog(data = {}) {
  const p = period(data);
  const limit = Math.min(Math.max(Number(data.limit) || 200, 1), 500);
  const snap = await db
    .collection('AuditLog')
    .where('time', '>=', p.from)
    .where('time', '<=', p.to)
    .orderBy('time', 'desc')
    .limit(limit)
    .get();
  const wanted = words(data.query);
  return docs(snap)
    .map(auditRow)
    .filter((a) => !data.via || a.via === data.via)
    .filter((a) => !data.failed || !a.ok)
    .filter((a) => {
      const text = [a.action, a.who, a.email, a.target?.kind, a.target?.id, a.error].join(' ').toLowerCase();
      return wanted.every((w) => text.includes(w));
    });
}

// ---------- Error log ----------

async function errorLog(data = {}) {
  const p = period(data);
  const limit = Math.min(Math.max(Number(data.limit) || 200, 1), 500);
  const snap = await db
    .collection('Logs')
    .where('time', '>=', p.from)
    .where('time', '<=', p.to)
    .orderBy('time', 'desc')
    .limit(limit)
    .get();
  const wanted = words(data.query);
  return docs(snap)
    .map((l) => ({ id: l.id, time: iso(l.time), action: l.action || '', error: l.error || '', details: l.details || '' }))
    .filter((l) => wanted.every((w) => [l.action, l.error, l.details].join(' ').toLowerCase().includes(w)));
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
const PERIOD = {
  from: str('first day, yyyy-MM-dd (default: 30 days ago)'),
  to: str('last day, yyyy-MM-dd (default: today)'),
};

const tools = {
  dashboard_summary: {
    sides: ['admin'],
    description:
      'The business at a glance for a period: clients (total, new), orders by status, revenue received, outstanding ' +
      'payments, active services, lawyers and applications, lawyer tasks waiting, stuck steps, errors, chat questions ' +
      'and the latest admin activity. Website traffic and AI spending are not tracked yet (null).',
    parameters: { type: 'object', properties: PERIOD },
    run: safe(async (ctx, a) => {
      const d = await dashboard(a);
      // The chat needs the figures, not the chart points
      return { ...d, series: undefined, recent: d.recent.slice(0, 5).map(({ data, ...rest }) => rest) };
    }),
  },
  audit_find: {
    sides: ['admin'],
    description:
      'The audit log: changes made by admins, newest first, with who, when, what record, before → after values and ' +
      'whether it came from the panel or the chat. Filter by words (action, person, record id), via (panel | chat) ' +
      'or failed only.',
    parameters: {
      type: 'object',
      properties: {
        ...PERIOD,
        query: str('words to look for'),
        via: { type: 'string', enum: ['panel', 'chat'] },
        failed: { type: 'boolean' },
      },
    },
    run: safe(async (ctx, a) => (await auditLog({ ...a, limit: 100 })).slice(0, 30).map(({ data, ...rest }) => rest)),
  },
  errors_find: {
    sides: ['admin'],
    description: 'Failed jobs and requests (system errors), newest first; filter by words.',
    parameters: { type: 'object', properties: { ...PERIOD, query: str('words to look for') } },
    run: safe(async (ctx, a) =>
      (await errorLog({ ...a, limit: 100 })).slice(0, 30).map((l) => ({ ...l, details: l.details.slice(0, 300) })),
    ),
  },
};

export default {
  id: 'admin-insights',
  sides: ['admin'],
  actions: {
    admin: {
      'admin:dashboard': (caller, data) => dashboard(data),
      'admin:audit': (caller, data) => auditLog(data),
      'admin:logs': (caller, data) => errorLog(data),
    },
  },
  tools,
};
