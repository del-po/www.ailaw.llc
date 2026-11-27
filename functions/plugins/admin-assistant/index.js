// ==========================================================
// Plugin: admin assistant (admin)
// The admin chat's tools for every admin section except 1% declarations
// (that tool has its own, in its plugin): orders, review, clients, lawyers,
// services and categories, blog.
// Questions run the section's own admin action and answer straight away.
// Changes are proposed (core/chat-actions.js): a card with Confirm, and
// only Confirm runs the same admin action its button would.
// ==========================================================

import { ApiError } from '../../core/app.js';
import { proposeAction } from '../../core/chat-actions.js';
import accounts from '../accounts/index.js';
import blog from '../blog/index.js';
import catalogue from '../catalogue/index.js';
import lawyerVerification from '../lawyer-verification/index.js';
import ordering from '../ordering/index.js';
import taskDesk from '../task-desk/index.js';

// The admin action table of the sections this assistant covers
const ROUTES = Object.assign(
  {},
  accounts.actions.admin,
  blog.actions.admin,
  catalogue.actions.admin,
  lawyerVerification.actions.admin,
  ordering.actions.admin,
  taskDesk.actions.admin,
);

// Runs an admin action as the person asking (reads only)
function ask(ctx, action, data = {}) {
  const route = ROUTES[action];
  if (!route) throw new ApiError('UNKNOWN_ACTION');
  const run = typeof route === 'function' ? route : route.run;
  return run(ctx.caller, data, ctx.env, {});
}

// Every tool answers with { error } instead of failing the conversation
const safe = (run) => async (ctx, args) => {
  try {
    return await run(ctx, args || {});
  } catch (err) {
    if (err instanceof ApiError) return { error: err.code };
    throw err;
  }
};

const words = (q) => String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
const matches = (q, ...fields) => words(q).every((w) => fields.join(' ').toLowerCase().includes(w));
const money = (n, cur = 'GEL') => `${Number(n || 0).toFixed(2)} ${cur}`;
const str = (description) => ({ type: 'string', description });
const tool = (description, properties, required, run) => ({
  sides: ['admin'],
  description,
  parameters: { type: 'object', properties, ...(required.length ? { required } : {}) },
  run: safe(run),
});
const CHANGE = ' Shows a Confirm card; nothing changes until the admin confirms.';

// ---------- Orders ----------

const orderShort = (o) => ({
  orderNumber: o.orderNumber,
  service: o.service,
  customer: o.customerName,
  email: o.customerEmail,
  total: o.total,
  currency: o.currency,
  billing: o.billing || 'once',
  orderStatus: o.orderStatus,
  paymentStatus: o.paymentStatus,
  createdAt: o.createdAt.slice(0, 10),
});

// An order by its number (AIL-…) or id
async function findOrder(ctx, ref) {
  const wanted = String(ref || '').trim().toUpperCase();
  const order = (await ask(ctx, 'adminListOrders')).find(
    (o) => o.orderNumber.toUpperCase() === wanted || o.orderId.toUpperCase() === wanted,
  );
  if (!order) throw new ApiError('ORDER_NOT_FOUND');
  return order;
}

const orderTools = {
  orders_find: tool(
    'Finds orders by number, client name, email or service (empty = latest), optionally by order status ' +
      '(placed, in_progress, completed, cancelled) or payment status (unpaid, paid, refunded). Newest first.',
    { query: str('words to look for'), orderStatus: str('optional'), paymentStatus: str('optional') },
    [],
    async (ctx, a) =>
      (await ask(ctx, 'adminListOrders'))
        .filter((o) => matches(a.query, o.orderNumber, o.customerName, o.customerEmail, o.service))
        .filter((o) => !a.orderStatus || o.orderStatus === a.orderStatus)
        .filter((o) => !a.paymentStatus || o.paymentStatus === a.paymentStatus)
        .slice(0, 25)
        .map(orderShort),
  ),
  order_details: tool(
    'One order in full: lines, statuses, client details, notes and the lawyers assigned.',
    { order: str('order number AIL-…') },
    ['order'],
    async (ctx, a) => ask(ctx, 'adminGetOrder', { orderId: (await findOrder(ctx, a.order)).orderId }),
  ),
  order_update: tool(
    "Proposes changing an order's status (placed, in_progress, completed, cancelled) and/or payment status " +
      '(unpaid, paid, refunded). Marking paid sends the client a receipt and starts the work.' +
      CHANGE,
    { order: str('order number AIL-…'), orderStatus: str('optional'), paymentStatus: str('optional') },
    ['order'],
    async (ctx, a) => {
      const o = await findOrder(ctx, a.order);
      const data = { orderId: o.orderId };
      const lines = [`${o.service} · ${o.customerName} · ${money(o.total, o.currency)}`];
      if (a.orderStatus) {
        data.orderStatus = a.orderStatus;
        lines.push(`Order: ${o.orderStatus} → ${a.orderStatus}`);
      }
      if (a.paymentStatus) {
        data.paymentStatus = a.paymentStatus;
        lines.push(`Payment: ${o.paymentStatus} → ${a.paymentStatus}`);
        if (a.paymentStatus === 'paid' && o.paymentStatus !== 'paid') lines.push('The client gets a receipt by email.');
      }
      if (lines.length === 1) return { error: 'NOTHING_TO_CHANGE' };
      return proposeAction(ctx, { action: 'adminUpdateOrder', data, title: `Order ${o.orderNumber}`, lines });
    },
  ),
  order_remake_agreement: tool(
    "Proposes making an order's agreement PDF again from the order as it is now." + CHANGE,
    { order: str('order number AIL-…') },
    ['order'],
    async (ctx, a) => {
      const o = await findOrder(ctx, a.order);
      return proposeAction(ctx, {
        action: 'admin:remakeAgreement',
        data: { orderId: o.orderId },
        title: `Remake the agreement of ${o.orderNumber}`,
        lines: [`${o.service} · ${o.customerName}`],
      });
    },
  ),
  order_resend_email: tool(
    "Proposes sending an order's confirmation email (with the agreement) to the client again." + CHANGE,
    { order: str('order number AIL-…') },
    ['order'],
    async (ctx, a) => {
      const o = await findOrder(ctx, a.order);
      return proposeAction(ctx, {
        action: 'admin:resendEmail',
        data: { orderId: o.orderId },
        title: `Email ${o.orderNumber} to ${o.customerName} again`,
        lines: [`To ${o.customerEmail}`],
      });
    },
  ),
  order_create: tool(
    'Proposes an order taken by phone or Telegram: for an existing client (clientId ID-…, from clients_find) or a ' +
      'new guest (guestFirstName, guestLastName, guestEmail, guestPhone); items are service slugs from services_list ' +
      'with quantities; payment "invoice" (an invoice is emailed) or "paid" (already paid).' +
      CHANGE,
    {
      clientId: str('existing client ID-…'),
      guestFirstName: str(''),
      guestLastName: str(''),
      guestEmail: str(''),
      guestPhone: str(''),
      items: {
        type: 'array',
        items: { type: 'object', properties: { slug: { type: 'string' }, quantity: { type: 'number' } }, required: ['slug'] },
      },
      payment: { type: 'string', enum: ['invoice', 'paid'] },
      customerNotes: str('optional'),
    },
    ['items'],
    async (ctx, a) => {
      const services = await ask(ctx, 'services:list');
      const items = (a.items || []).map((i) => ({ slug: i.slug, quantity: i.quantity || 1 }));
      const unknown = items.filter((i) => !services.some((s) => s.Slug === i.slug));
      if (!items.length || unknown.length) return { error: 'UNKNOWN_SERVICE', slugs: unknown.map((i) => i.slug) };
      let who = '';
      const data = { items, payment: a.payment === 'paid' ? 'paid' : 'invoice', customerNotes: a.customerNotes || '' };
      if (a.clientId) {
        const c = (await ask(ctx, 'admin:clients')).find((x) => x.ClientID === a.clientId);
        if (!c) return { error: 'CLIENT_NOT_FOUND' };
        data.clientId = a.clientId;
        who = `${c.DisplayName} (${c.ClientID})`;
      } else {
        data.guest = { firstName: a.guestFirstName, lastName: a.guestLastName, email: a.guestEmail, phone: a.guestPhone };
        who = `New guest ${a.guestFirstName || ''} ${a.guestLastName || ''} <${a.guestEmail || 'no email'}>`.trim();
      }
      const lines = items.map((i) => {
        const s = services.find((x) => x.Slug === i.slug);
        return `${s.Name} × ${i.quantity} · ${s.Price} ${s.Currency}${s.Billing === 'ongoing' ? ' ' + s.UnitLabel : ''}`;
      });
      lines.push(data.payment === 'paid' ? 'Already paid: the client gets a receipt' : 'By invoice: the agreement and invoice are emailed');
      return proposeAction(ctx, { action: 'admin:createOrder', data, title: `New order for ${who}`, lines });
    },
  ),
  order_assign_lawyer: tool(
    'Proposes giving an open order to a lawyer (lawyerId LW-… from lawyers_list) as lead or reviewer; the lawyer is emailed.' +
      CHANGE,
    { order: str('order number AIL-…'), lawyerId: str('LW-…'), role: { type: 'string', enum: ['lead', 'reviewer'] } },
    ['order', 'lawyerId'],
    async (ctx, a) => {
      const o = await findOrder(ctx, a.order);
      const l = (await ask(ctx, 'admin:lawyers')).find((x) => x.lawyerId === a.lawyerId);
      if (!l) return { error: 'LAWYER_NOT_FOUND' };
      return proposeAction(ctx, {
        action: 'admin:assign',
        data: { orderNumber: o.orderNumber, lawyerId: l.lawyerId, role: a.role === 'reviewer' ? 'reviewer' : 'lead' },
        title: `Give ${o.orderNumber} to ${l.firstName} ${l.lastName}`,
        lines: [`${o.service} · ${o.customerName}`, `As ${a.role === 'reviewer' ? 'reviewer' : 'lead'}; they are emailed`],
      });
    },
  ),
};

// ---------- Review ----------

const reviewTools = {
  review_tasks: tool(
    'Order steps waiting for AI Law (lawyer steps nobody has done yet), oldest first.',
    {},
    [],
    async (ctx) => ask(ctx, 'admin:tasks'),
  ),
  review_complete_step: tool(
    'Proposes marking a waiting step done (order number and step number from review_tasks), with an optional ' +
      'result link and note; the order then moves on.' +
      CHANGE,
    { order: str('order number AIL-…'), stepNo: { type: 'number' }, result: str('optional link'), note: str('optional') },
    ['order', 'stepNo'],
    async (ctx, a) => {
      const task = (await ask(ctx, 'admin:tasks')).find((t) => t.orderId === a.order && Number(t.stepNo) === Number(a.stepNo));
      if (!task) return { error: 'STEP_NOT_FOUND' };
      return proposeAction(ctx, {
        action: 'admin:completeStep',
        data: { orderId: a.order, stepNo: Number(a.stepNo), result: a.result || '', note: a.note || '' },
        title: `Done: ${task.label}`,
        lines: [`${task.service} · ${a.order} · ${task.clientName}`, ...(a.result ? [`Result: ${a.result}`] : [])],
      });
    },
  ),
};

// ---------- Clients ----------

const clientShort = (c) => ({
  clientId: c.ClientID,
  name: c.DisplayName,
  email: c.Email,
  phone: c.Phone,
  type: c.Type,
  status: c.Status,
  hasLogin: !!c.UserID,
  role: c.Role,
});

async function findClientRecord(ctx, clientId) {
  const c = (await ask(ctx, 'admin:clients')).find((x) => x.ClientID === String(clientId || '').trim());
  if (!c) throw new ApiError('CLIENT_NOT_FOUND');
  return c;
}

const clientTools = {
  clients_find: tool(
    'Finds clients (accounts, verified clients, guests) by name, ID-… code, email, phone, passport or ID number; ' +
      'optionally by type (user, verified, guest).',
    { query: str('words to look for'), type: str('optional') },
    [],
    async (ctx, a) =>
      (await ask(ctx, 'admin:clients'))
        .filter((c) => matches(a.query, c.ClientID, c.DisplayName, c.Email, c.Phone, c.Passport, c.IDNumber))
        .filter((c) => !a.type || c.Type === a.type)
        .slice(0, 30)
        .map(clientShort),
  ),
  client_verify: tool(
    "Proposes verifying a client after the identity check: passport and/or ID number (one is needed), address, phone. " +
      'Verified clients can order every service.' +
      CHANGE,
    { clientId: str('ID-…'), passport: str(''), idNumber: str(''), address: str(''), phone: str('') },
    ['clientId'],
    async (ctx, a) => {
      const c = await findClientRecord(ctx, a.clientId);
      if (!a.passport && !a.idNumber && !c.Passport && !c.IDNumber) return { error: 'PASSPORT_OR_ID_REQUIRED' };
      const data = {
        clientId: c.ClientID,
        passport: a.passport ?? c.Passport,
        idNumber: a.idNumber ?? c.IDNumber,
        address: a.address ?? c.Address,
        phone: a.phone ?? c.Phone,
      };
      return proposeAction(ctx, {
        action: 'admin:verifyClient',
        data,
        title: `Verify ${c.DisplayName} (${c.ClientID})`,
        lines: [
          `Passport: ${data.passport || '—'} · ID: ${data.idNumber || '—'}`,
          `Address: ${data.address || '—'} · Phone: ${data.phone || '—'}`,
          'Their folder moves to verified.',
        ],
      });
    },
  ),
  client_unverify: tool(
    "Proposes removing a client's verification." + CHANGE,
    { clientId: str('ID-…') },
    ['clientId'],
    async (ctx, a) => {
      const c = await findClientRecord(ctx, a.clientId);
      return proposeAction(ctx, {
        action: 'admin:unverifyClient',
        data: { clientId: c.ClientID },
        title: `Remove ${c.DisplayName}'s verification`,
        lines: [c.UserID ? 'They become an ordinary account again.' : 'They become a guest again.'],
      });
    },
  ),
  client_set_account_status: tool(
    "Proposes suspending a client's website account (they can't sign in) or reactivating it." + CHANGE,
    { clientId: str('ID-…'), status: { type: 'string', enum: ['active', 'suspended'] } },
    ['clientId', 'status'],
    async (ctx, a) => {
      const c = await findClientRecord(ctx, a.clientId);
      if (!c.UserID) return { error: 'NO_ACCOUNT' };
      return proposeAction(ctx, {
        action: 'setUserStatus',
        data: { userId: c.UserID, status: a.status },
        title: `${a.status === 'suspended' ? 'Suspend' : 'Reactivate'} ${c.DisplayName}'s account`,
        lines: [c.Email],
        danger: a.status === 'suspended',
      });
    },
  ),
  client_link_account: tool(
    "Proposes joining a website account (accountClientId: the ID-… the sign-up made) to an existing client without a login " +
      '(clientId). The existing client keeps code, folder and history; the other record is closed.' +
      CHANGE,
    { clientId: str('existing client ID-… (no login)'), accountClientId: str('the website account ID-…') },
    ['clientId', 'accountClientId'],
    async (ctx, a) => {
      const target = await findClientRecord(ctx, a.clientId);
      const account = await findClientRecord(ctx, a.accountClientId);
      if (!account.UserID) return { error: 'NO_ACCOUNT' };
      return proposeAction(ctx, {
        action: 'admin:linkAccount',
        data: { clientId: target.ClientID, userId: account.UserID },
        title: `Join ${account.Email}'s login to ${target.DisplayName} (${target.ClientID})`,
        lines: [`${account.ClientID}'s orders and files move to ${target.ClientID}; ${account.ClientID} is closed.`],
        danger: true,
      });
    },
  ),
};

// ---------- Lawyers ----------

const lawyerTools = {
  lawyers_list: tool(
    'Lawyers and applications, optionally by status (applied, approved, active, suspended, left).',
    { status: str('optional') },
    [],
    async (ctx, a) =>
      (await ask(ctx, 'admin:lawyers'))
        .filter((l) => !a.status || l.status === a.status)
        .map(({ lawyerId, status, firstName, lastName, email, phone, specializations, languages, barLicenseNumber }) => ({
          lawyerId, status, name: `${firstName} ${lastName}`, email, phone, specializations, languages, barLicenseNumber,
        })),
  ),
  lawyer_approve: tool(
    'Proposes approving a lawyer application: their login is made and they get a password link by email.' + CHANGE,
    { lawyerId: str('LW-…') },
    ['lawyerId'],
    async (ctx, a) => {
      const l = (await ask(ctx, 'admin:lawyers')).find((x) => x.lawyerId === a.lawyerId);
      if (!l) return { error: 'LAWYER_NOT_FOUND' };
      return proposeAction(ctx, {
        action: 'admin:approveLawyer',
        data: { lawyerId: l.lawyerId },
        title: `Approve ${l.firstName} ${l.lastName}`,
        lines: [`${l.email} gets a link to set a password and opens the Workspace.`],
      });
    },
  ),
  lawyer_reject: tool(
    'Proposes declining a lawyer application.' + CHANGE,
    { lawyerId: str('LW-…') },
    ['lawyerId'],
    async (ctx, a) => {
      const l = (await ask(ctx, 'admin:lawyers')).find((x) => x.lawyerId === a.lawyerId);
      if (!l) return { error: 'LAWYER_NOT_FOUND' };
      return proposeAction(ctx, {
        action: 'admin:rejectLawyer',
        data: { lawyerId: l.lawyerId },
        title: `Decline ${l.firstName} ${l.lastName}'s application`,
        lines: [l.email],
        danger: true,
      });
    },
  ),
};

// ---------- Services and categories ----------

const SERVICE_FIELDS = {
  Name: 'name',
  Price: 'price',
  DiscountedPrice: 'discounted price ("" = none)',
  DiscountStart: 'yyyy-mm-dd',
  DiscountEnd: 'yyyy-mm-dd',
  Status: 'Active, Draft or Inactive',
  ShortDescription: 'one line',
  Description: 'full text',
  Category: 'an existing category',
  Billing: 'once or ongoing',
  UnitLabel: 'for ongoing, e.g. "per declaration"',
};

async function findService(ctx, ref) {
  const wanted = String(ref || '').toLowerCase();
  const s = (await ask(ctx, 'services:list')).find((x) => x.Slug === wanted || String(x.ID) === wanted || x.Name.toLowerCase() === wanted);
  if (!s) throw new ApiError('SERVICE_NOT_FOUND');
  return s;
}

const serviceTools = {
  services_list: tool(
    'Every service with its slug, price, discount, status, category, billing and what checkout asks for.',
    {},
    [],
    async (ctx) => ask(ctx, 'services:list'),
  ),
  service_update: tool(
    'Proposes changing a service (by slug or name). Only the fields given change: ' +
      Object.entries(SERVICE_FIELDS).map(([k, v]) => `${k} (${v})`).join(', ') +
      '.' +
      CHANGE,
    { service: str('slug or name'), ...Object.fromEntries(Object.keys(SERVICE_FIELDS).map((k) => [k, { type: k === 'Price' ? 'number' : 'string' }])) },
    ['service'],
    async (ctx, a) => {
      const s = await findService(ctx, a.service);
      const changes = {};
      const lines = [];
      for (const k of Object.keys(SERVICE_FIELDS)) {
        if (a[k] === undefined) continue;
        changes[k] = a[k];
        const before = String(s[k] ?? '');
        lines.push(`${k}: ${before.length > 60 ? before.slice(0, 60) + '…' : before || '—'} → ${String(a[k]).slice(0, 80) || '—'}`);
      }
      if (!lines.length) return { error: 'NOTHING_TO_CHANGE' };
      return proposeAction(ctx, { action: 'services:update', data: { id: s.ID, data: changes }, title: `Change ${s.Name}`, lines });
    },
  ),
  service_create: tool(
    'Proposes a new service (saved as Draft unless Status is given): Name, Price, Category, and optionally ' +
      'ShortDescription, Description, Currency, Billing, UnitLabel.' +
      CHANGE,
    {
      Name: str(''),
      Price: { type: 'number' },
      Category: str('an existing category'),
      ShortDescription: str(''),
      Description: str(''),
      Currency: str('GEL by default'),
      Status: str('Draft by default'),
      Billing: str('once or ongoing'),
      UnitLabel: str(''),
    },
    ['Name', 'Price', 'Category'],
    async (ctx, a) =>
      proposeAction(ctx, {
        action: 'services:create',
        data: { data: { Status: 'Draft', Currency: 'GEL', ...a } },
        title: `New service: ${a.Name}`,
        lines: [`${a.Price} ${a.Currency || 'GEL'}${a.Billing === 'ongoing' ? ' ' + (a.UnitLabel || '') : ''} · ${a.Category}`, `Status: ${a.Status || 'Draft'}`],
      }),
  ),
  service_archive: tool(
    'Proposes archiving a service (status Inactive: hidden from the site; past orders keep it).' + CHANGE,
    { service: str('slug or name') },
    ['service'],
    async (ctx, a) => {
      const s = await findService(ctx, a.service);
      return proposeAction(ctx, { action: 'services:delete', data: { id: s.ID }, title: `Archive ${s.Name}`, lines: ['Hidden from the site; past orders keep it.'] });
    },
  ),
  categories_list: tool('Service categories with their status.', {}, [], async (ctx) => ask(ctx, 'categories:list')),
  category_create: tool(
    'Proposes a new service category.' + CHANGE,
    { name: str('') },
    ['name'],
    async (ctx, a) => proposeAction(ctx, { action: 'categories:create', data: { data: { Name: a.name } }, title: `New category: ${a.name}`, lines: [] }),
  ),
};

// ---------- Blog ----------

const blogTools = {
  blog_list: tool('Blog articles: slug, title, category, status (draft/published), featured, dates.', {}, [], async (ctx) =>
    ask(ctx, 'blog:list'),
  ),
  blog_get: tool(
    'One article in full (Markdown body).',
    { slug: str('') },
    ['slug'],
    async (ctx, a) => ask(ctx, 'blog:get', { slug: a.slug }),
  ),
  blog_save: tool(
    'Proposes writing or changing an article: for an existing one give its slug and only the fields that change; a ' +
      'new one needs title and body (Markdown). Fields: title, deck, body, category, tags (comma-separated), ' +
      'featured, status (draft or published).' +
      CHANGE,
    {
      slug: str('existing article, or empty for a new one'),
      title: str(''),
      deck: str('one-line summary'),
      body: str('Markdown'),
      category: str(''),
      tags: str('comma-separated'),
      featured: { type: 'boolean' },
      status: { type: 'string', enum: ['draft', 'published'] },
    },
    [],
    async (ctx, a) => {
      // A change keeps everything that isn't given
      let old = null;
      if (a.slug) {
        try {
          old = await ask(ctx, 'blog:get', { slug: a.slug });
        } catch {
          old = null;
        }
      }
      const post = { ...(old || {}), ...Object.fromEntries(Object.entries(a).filter(([, v]) => v !== undefined)) };
      if (!post.title || !post.body) return { error: 'TITLE_AND_BODY_REQUIRED' };
      const changed = Object.keys(a).filter((k) => k !== 'slug');
      return proposeAction(ctx, {
        action: 'blog:save',
        data: {
          slug: old?.slug || a.slug || '',
          title: post.title,
          deck: post.deck || '',
          body: post.body,
          author: post.author || '',
          category: post.category || '',
          tags: post.tags || '',
          featured: post.featured === true,
          status: post.status === 'published' ? 'published' : 'draft',
        },
        title: old ? `Change the article "${post.title}"` : `New article "${post.title}"`,
        lines: [
          old ? `Changes: ${changed.join(', ') || 'none'}` : `${post.body.split(/\s+/).length} words`,
          `Status: ${post.status === 'published' ? 'published (on the site)' : 'draft'}`,
        ],
      });
    },
  ),
  blog_delete: tool(
    'Proposes deleting an article.' + CHANGE,
    { slug: str('') },
    ['slug'],
    async (ctx, a) => {
      const p = await ask(ctx, 'blog:get', { slug: a.slug });
      return proposeAction(ctx, { action: 'blog:delete', data: { slug: p.slug }, title: `Delete the article "${p.title}"`, lines: ["This can't be undone."], danger: true });
    },
  ),
};

export default {
  id: 'admin-assistant',
  sides: ['admin'],
  tools: { ...orderTools, ...reviewTools, ...clientTools, ...lawyerTools, ...serviceTools, ...blogTools },
};
