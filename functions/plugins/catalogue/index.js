// ==========================================================
// Plugin: catalogue (client + admin)
// Client (public):  services, service, categories — the services pages
// Client (chat):    the services list in the AI's instructions, and the
//                   offer_service tool, which shows a service card
// Admin:            services and categories: list, create, update, archive
// Services/{slug} is the catalogue record; the work behind a service lives
// in its plugin (service.plugin → Plugins/{id}).
// ==========================================================

import { ApiError, COMPANY, db, formatDate, now, slugify, toDate } from '../../core/app.js';
import { addPart } from '../../core/chat.js';
import { publicUrl } from '../../core/files.js';
import { pluginRecords } from '../../core/loader.js';
import { clientByUid, forget, priceOf, serviceBySlug, services, setting } from '../../core/records.js';

const STATUSES = { active: 'Active', inactive: 'Inactive', draft: 'Draft' };
const fromLabel = (label) => String(label || '').toLowerCase();
const dateText = (value) => (toDate(value) ? formatDate(value) : '');

// A Storage path (services/….jpg) becomes a picture link; Drive links and ids
// and other URLs still work
async function imageUrl(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (/^services\//.test(text)) {
    try {
      return await publicUrl(text);
    } catch {
      return '';
    }
  }
  const id = text.match(/\/d\/([\w-]{20,})/) || text.match(/[?&]id=([\w-]{20,})/);
  if (id) return 'https://lh3.googleusercontent.com/d/' + id[1];
  if (/^[\w-]{20,}$/.test(text)) return 'https://lh3.googleusercontent.com/d/' + text;
  return text;
}

// ---------- Public ----------

async function toPublic(s) {
  const { price, finalPrice, onSale } = priceOf(s);
  return {
    ID: Number(s.number),
    Slug: s.serviceId,
    Name: s.name || '',
    ShortDescription: s.shortDescription || '',
    Description: s.description || '',
    Category: s.category || '',
    Image: await imageUrl(s.image),
    Currency: s.currency || 'GEL',
    Price: price,
    FinalPrice: finalPrice,
    OnSale: onSale,
    DiscountEnd: onSale ? dateText(s.discountEnd) : '',
  };
}

const activeServices = async () =>
  (await services()).filter((s) => s.status === 'active').sort((a, b) => a.number - b.number);

async function categories() {
  return ((await setting('categories')).list || [])
    .filter((c) => c.status === 'active')
    .map((c) => ({ ID: Number(c.id), Name: c.name }));
}

// ---------- Admin: services ----------

function toAdmin(s) {
  return {
    ID: Number(s.number),
    Slug: s.serviceId,
    Name: s.name || '',
    ShortDescription: s.shortDescription || '',
    Description: s.description || '',
    Category: s.category || '',
    Image: s.image || '',
    Status: STATUSES[s.status] || 'Draft',
    Currency: s.currency || 'GEL',
    Price: Number(s.price) || 0,
    DiscountedPrice: s.discountedPrice ? Number(s.discountedPrice) : '',
    DiscountStart: dateText(s.discountStart),
    DiscountEnd: dateText(s.discountEnd),
  };
}

const EDITABLE = {
  Slug: 'serviceId',
  Name: 'name',
  ShortDescription: 'shortDescription',
  Description: 'description',
  Price: 'price',
  Category: 'category',
  Image: 'image',
  Status: 'status',
  DiscountedPrice: 'discountedPrice',
  DiscountStart: 'discountStart',
  DiscountEnd: 'discountEnd',
  Currency: 'currency',
};

async function allServices() {
  forget('services');
  return services();
}

// The website's fields → a checked service record
async function checkService(input, base, list) {
  const s = { ...base };
  for (const [field, key] of Object.entries(EDITABLE)) {
    if (Object.prototype.hasOwnProperty.call(input, field)) s[key] = input[field];
  }
  s.name = String(s.name ?? '').trim();
  s.serviceId = slugify(s.serviceId || s.name);
  s.price = s.price === '' || s.price == null ? NaN : Number(s.price);
  s.discountedPrice = s.discountedPrice === '' || s.discountedPrice == null ? 0 : Number(s.discountedPrice);
  s.discountStart = s.discountStart ? new Date(s.discountStart) : null;
  s.discountEnd = s.discountEnd ? new Date(s.discountEnd) : null;
  s.category = String(s.category ?? '').trim();
  s.currency = String(s.currency || 'GEL').toUpperCase();
  s.status = fromLabel(s.status) || 'draft';

  if (!s.name) throw new ApiError('Name is required.');
  if (!Number.isFinite(s.price) || s.price < 0) throw new ApiError('Invalid price.');
  if (!STATUSES[s.status]) throw new ApiError('Invalid service status.');
  if (!Number.isFinite(s.discountedPrice) || s.discountedPrice < 0 || s.discountedPrice > s.price) {
    throw new ApiError('Invalid discounted price.');
  }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.serviceId)) throw new ApiError('Invalid slug.');
  if (list.some((o) => o.serviceId === s.serviceId && o.number !== s.number)) {
    throw new ApiError('Slug already used by another service.');
  }
  if (!(await categories()).some((c) => c.Name === s.category)) {
    throw new ApiError('Choose an existing Active category.');
  }
  s.updatedAt = now();
  return s;
}

async function createService(input) {
  const list = await allServices();
  const number = Math.max(0, ...list.map((s) => Number(s.number) || 0)) + 1;
  const s = await checkService(input, {
    number, requires: 'user', lawyerFee: 0, chatSummary: '', whenToOffer: '', link: '', plugin: '', image: '',
    shortDescription: '', description: '', status: 'draft', createdAt: now(),
  }, list);
  await db.doc('Services/' + s.serviceId).set(s);
  forget('services');
  return toAdmin(s);
}

async function updateService(id, input) {
  const list = await allServices();
  const old = list.find((s) => Number(s.number) === Number(id));
  if (!old) throw new ApiError('Service not found.');
  const { id: oldSlug, ...base } = old;
  const s = await checkService(input, base, list);
  // The slug is the record's id: a new slug moves the record
  if (s.serviceId !== oldSlug) await db.doc('Services/' + oldSlug).delete();
  await db.doc('Services/' + s.serviceId).set(s);
  forget('services');
  return toAdmin(s);
}

// Archives instead of deleting, so past orders still point to a real record
async function archiveService(id) {
  const old = (await allServices()).find((s) => Number(s.number) === Number(id));
  if (!old) throw new ApiError('Service not found.');
  await db.doc('Services/' + old.id).update({ status: 'inactive', updatedAt: now() });
  forget('services');
  return { ID: Number(id), Status: 'Inactive' };
}

// ---------- Admin: categories ----------

async function categoryList() {
  forget('setting:categories');
  return (await setting('categories')).list || [];
}

async function saveCategories(list) {
  await db.doc('Settings/categories').set({ list });
  forget('setting:categories');
}

const toAdminCategory = (c) => ({ ID: Number(c.id), Name: c.name, Status: STATUSES[c.status] || 'Inactive' });

async function createCategory(input) {
  const name = String(input?.Name ?? '').trim();
  if (!name || /^[=+@-]/.test(name)) throw new ApiError('Invalid category name.');
  const list = await categoryList();
  if (list.some((c) => c.name.toLowerCase() === name.toLowerCase())) throw new ApiError('Category already exists.');
  const category = { id: Math.max(0, ...list.map((c) => Number(c.id))) + 1, name, status: 'active' };
  await saveCategories([...list, category]);
  return toAdminCategory(category);
}

async function updateCategory(id, input) {
  const list = await categoryList();
  const old = list.find((c) => Number(c.id) === Number(id));
  if (!old) throw new ApiError('Category not found.');
  const name = input.Name === undefined ? old.name : String(input.Name).trim();
  const status = input.Status === undefined ? old.status : fromLabel(input.Status);
  if (!name || /^[=+@-]/.test(name) || !['active', 'inactive'].includes(status)) {
    throw new ApiError('Invalid category information.');
  }
  if (list.some((c) => c.id !== old.id && c.name.toLowerCase() === name.toLowerCase())) {
    throw new ApiError('Category name already exists.');
  }
  const linked = (await allServices()).filter((s) => s.category === old.name);
  if (status === 'inactive' && linked.length) throw new ApiError('Category is still assigned to services.');

  await saveCategories(list.map((c) => (c.id === old.id ? { ...c, name, status } : c)));
  // Renaming a category renames it on every service that uses it
  if (name !== old.name && linked.length) {
    const batch = db.batch();
    linked.forEach((s) => batch.update(db.doc('Services/' + s.id), { category: name }));
    await batch.commit();
    forget('services');
  }
  return toAdminCategory({ id: old.id, name, status });
}

async function archiveCategory(id) {
  const list = await categoryList();
  const old = list.find((c) => Number(c.id) === Number(id));
  if (!old) throw new ApiError('Category not found.');
  if ((await allServices()).some((s) => s.category === old.name)) {
    throw new ApiError('Cannot archive a category assigned to services.');
  }
  await saveCategories(list.map((c) => (c.id === old.id ? { ...c, status: 'inactive' } : c)));
  return { ID: Number(id), Status: 'Inactive' };
}

// ---------- Chat ----------

// The services list in the AI's instructions, with the details each needs
async function servicesPrompt(ctx) {
  const plugins = await pluginRecords();
  const list = (await activeServices()).map((s) => {
    const fields = (plugins[s.plugin]?.fields || [])
      .map((f) => `  - ${f.field} (${f.label}${f.hint ? '; ' + f.hint : ''})${f.required ? '' : ' — optional'}`)
      .join('\n');
    const { finalPrice } = priceOf(s);
    return (
      `- id: ${s.serviceId} — ${s.name}, ${finalPrice} ${s.currency}` +
      (s.requires === 'verified' ? ' (verified clients only)' : '') +
      `\n  ${s.chatSummary || s.shortDescription}` +
      (s.whenToOffer ? `\n  Offer when: ${s.whenToOffer}` : '') +
      (fields ? `\n  Details needed to order:\n${fields}` : '')
    );
  });

  const client = ctx.caller.signedIn ? await clientByUid(ctx.caller.uid) : null;
  const status = !ctx.caller.signedIn
    ? 'The client is not signed in: they can ask questions, but must sign in (Log in, top right) before ordering.'
    : client?.type === 'verified'
      ? 'The client is verified, so they can order every service.'
      : `The client is not verified: services marked "verified clients only" can't be ordered yet; ` +
        `for those, tell them to contact ${COMPANY.verifyContact} to get verified.`;

  return `## Services list\n${list.join('\n') || '(no services yet)'}\n\n## Client status\n${status}`;
}

export default {
  id: 'catalogue',
  sides: ['client', 'admin'],
  actions: {
    client: {
      services: { public: true, run: async () => Promise.all((await activeServices()).map(toPublic)) },
      service: {
        public: true,
        run: async (_, data) => {
          const s = data.slug
            ? await serviceBySlug(String(data.slug))
            : (await services()).find((x) => Number(x.number) === Number(data.id));
          return s && s.status === 'active' ? toPublic(s) : null;
        },
      },
      categories: { public: true, run: () => categories() },
    },
    admin: {
      'services:list': async () => (await allServices()).sort((a, b) => a.number - b.number).map(toAdmin),
      'services:create': (caller, data) => createService(data.data || data),
      'services:update': (caller, data) => updateService(data.id, data.data || {}),
      'services:delete': (caller, data) => archiveService(data.id),
      'categories:list': async () => (await categoryList()).map(toAdminCategory),
      'categories:create': (caller, data) => createCategory(data.data || data),
      'categories:update': (caller, data) => updateCategory(data.id, data.data || {}),
      'categories:delete': (caller, data) => archiveCategory(data.id),
    },
  },
  tools: {
    offer_service: {
      sides: ['client'],
      description: 'Show the card of a service that fits the client, so they can see it and order.',
      parameters: {
        type: 'object',
        properties: { service_id: { type: 'string', description: 'id from the services list' } },
        required: ['service_id'],
      },
      run: async (ctx, args) => {
        const s = await serviceBySlug(String(args.service_id || ''));
        if (!s || s.status !== 'active') throw new ApiError('SERVICE_NOT_FOUND');
        const { finalPrice } = priceOf(s);
        addPart(ctx, {
          type: 'service',
          id: s.serviceId,
          title: s.name,
          summary: s.chatSummary || s.shortDescription,
          price: `${finalPrice} ${s.currency}`,
          link: s.link || `/services/${s.serviceId}`,
        });
        return { shown: true };
      },
    },
  },
  prompt: (ctx) => (ctx.side === 'client' ? servicesPrompt(ctx) : ''),
};
