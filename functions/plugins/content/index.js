// ==========================================================
// Plugin: content (client + admin)
// The website's own text, edited in the Admin Panel → Content: homepage
// texts, About, contact details, FAQs, the announcement bar, the privacy
// policy and the terms. Which blocks exist, what kind they are and their
// text as first written is the website's (src/app/core/content); this
// keeps what the admin has changed. A block nobody has published shows
// the website's own text, so nothing changes until something is published.
// Content/{key}:
//   type        text | markdown | list | fields
//   markdown    for list and fields: which of their fields are Markdown
//   draft       the value being edited
//   published   the value the site shows (absent = the site's own text)
//   draftAt, draftBy, publishedAt, publishedBy
//   + Versions: every published value replaced, to bring back
// Client (public):  content:published  every published block, Markdown as HTML
// Admin:            content:list, content:drafts (the site as the drafts
//                   would show it), content:preview, content:saveDraft,
//                   content:publish, content:unpublish, content:discard,
//                   content:versions, content:restore
// Layouts, components and styles stay in the code; only text lives here.
// ==========================================================

import { ApiError, cleanText, db, iso, now } from '../../core/app.js';
import { proposeAction } from '../../core/chat-actions.js';
import { toHtml } from '../../core/markdown.js';
import { cached, docs, forget } from '../../core/records.js';

const TYPES = ['text', 'markdown', 'list', 'fields'];
const KEY = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+){1,3}$/;
const MAX_TEXT = 200000;
const MAX_ITEMS = 100;
const VERSIONS_KEPT = 20;

const blocks = () => db.collection('Content');

function key(value) {
  const k = String(value || '');
  if (!KEY.test(k)) throw new ApiError('INVALID_CONTENT_KEY');
  return k;
}

// ---------- Values ----------

const cleanString = (v) => cleanText(String(v ?? ''), MAX_TEXT, 'INVALID_CONTENT');

// A value of its type, checked: text and markdown are strings, list a list
// of { field: text }, fields one { field: text }
function cleanValue(type, value) {
  if (type === 'text' || type === 'markdown') return cleanString(value);
  const record = (r) => {
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw new ApiError('INVALID_CONTENT');
    return Object.fromEntries(
      Object.entries(r)
        .slice(0, 30)
        .map(([k, v]) => [cleanText(k, 40, 'INVALID_CONTENT'), typeof v === 'boolean' ? v : cleanString(v)]),
    );
  };
  if (type === 'fields') return record(value);
  if (!Array.isArray(value) || value.length > MAX_ITEMS) throw new ApiError('INVALID_CONTENT');
  return value.map(record);
}

// The value as the site uses it: Markdown parts also come as HTML
// (a markdown block → html; a list or fields → "<field>Html" beside each)
function rendered(block, value) {
  if (value === undefined || value === null) return null;
  const md = block.markdown || [];
  if (block.type === 'markdown') {
    const html = toHtml(value);
    // Its parts ("#" headings), for a page's contents list
    const toc = [...html.matchAll(/<h2 id="([^"]+)">(.*?)<\/h2>/g)].map((m) => ({ id: m[1], title: m[2].replace(/<[^>]+>/g, '') }));
    return { value, html, toc };
  }
  if (block.type === 'text') return { value };
  const withHtml = (r) => ({ ...r, ...Object.fromEntries(md.filter((f) => typeof r[f] === 'string').map((f) => [f + 'Html', toHtml(r[f])])) });
  return { value: block.type === 'list' ? value.map(withHtml) : withHtml(value) };
}

// ---------- Public ----------

async function published() {
  return cached('content', 60, async () => {
    const out = {};
    for (const b of docs(await blocks().get())) {
      if (b.published === undefined || b.published === null) continue;
      out[b.id] = { type: b.type, ...rendered(b, b.published), publishedAt: iso(b.publishedAt) };
    }
    return { blocks: out };
  });
}

// ---------- Admin ----------

const toAdmin = (b) => ({
  key: b.id,
  type: b.type,
  markdown: b.markdown || [],
  draft: b.draft ?? null,
  published: b.published ?? null,
  // What is waiting: a draft that differs from what the site shows
  changed: b.draft !== undefined && b.draft !== null && JSON.stringify(b.draft) !== JSON.stringify(b.published ?? null),
  draftAt: iso(b.draftAt),
  draftBy: b.draftBy || '',
  publishedAt: iso(b.publishedAt),
  publishedBy: b.publishedBy || '',
});

async function list() {
  return docs(await blocks().get()).map(toAdmin);
}

async function requireBlock(k) {
  const snap = await blocks().doc(key(k)).get();
  if (!snap.exists) throw new ApiError('CONTENT_NOT_FOUND');
  return { id: snap.id, ref: snap.ref, ...snap.data() };
}

// Every block as the draft would show it (blocks without a draft as
// published), for previewing the site before publishing
async function drafts() {
  const out = {};
  for (const b of docs(await blocks().get())) {
    const value = b.draft ?? b.published;
    if (value === undefined || value === null) continue;
    out[b.id] = { type: b.type, ...rendered(b, value), publishedAt: iso(b.publishedAt) };
  }
  return { blocks: out };
}

function preview(data) {
  const type = TYPES.includes(data.type) ? data.type : 'markdown';
  const block = { type, markdown: Array.isArray(data.markdown) ? data.markdown : [] };
  return rendered(block, cleanValue(type, data.value));
}

// The block is made on its first draft, with its type from the website
async function saveDraft(caller, data) {
  const k = key(data.key);
  const type = TYPES.includes(data.type) ? data.type : null;
  if (!type) throw new ApiError('INVALID_CONTENT');
  const markdown = (Array.isArray(data.markdown) ? data.markdown : []).map((f) => cleanText(f, 40, 'INVALID_CONTENT'));
  const ref = blocks().doc(k);
  await ref.set({ type, markdown, draft: cleanValue(type, data.value), draftAt: now(), draftBy: caller.email || '' }, { merge: true });
  return toAdmin({ id: k, ...(await ref.get()).data() });
}

async function keep(block, caller) {
  if (block.published === undefined || block.published === null) return;
  const versions = block.ref.collection('Versions');
  await versions.add({ value: block.published, publishedAt: block.publishedAt || null, savedAt: now(), by: caller.email || '' });
  const old = await versions.orderBy('savedAt', 'desc').offset(VERSIONS_KEPT).get();
  await Promise.all(old.docs.map((d) => d.ref.delete()));
}

async function publish(caller, data) {
  const block = await requireBlock(data.key);
  if (block.draft === undefined || block.draft === null) throw new ApiError('NOTHING_TO_PUBLISH');
  await keep(block, caller);
  await block.ref.update({ published: block.draft, publishedAt: now(), publishedBy: caller.email || '' });
  forget('content');
  return toAdmin({ ...block, published: block.draft, publishedAt: now(), publishedBy: caller.email || '' });
}

// The site shows its own text again; the draft stays
async function unpublish(caller, data) {
  const block = await requireBlock(data.key);
  await keep(block, caller);
  await block.ref.update({ published: null, publishedAt: null, publishedBy: caller.email || '' });
  forget('content');
  return toAdmin({ ...block, published: null });
}

// The draft goes back to what the site shows
async function discard(caller, data) {
  const block = await requireBlock(data.key);
  await block.ref.update({ draft: block.published ?? null, draftAt: now(), draftBy: caller.email || '' });
  return toAdmin({ ...block, draft: block.published ?? null });
}

async function versions(data) {
  const block = await requireBlock(data.key);
  const snap = await block.ref.collection('Versions').orderBy('savedAt', 'desc').limit(VERSIONS_KEPT).get();
  return docs(snap).map((v) => ({ id: v.id, savedAt: iso(v.savedAt), publishedAt: iso(v.publishedAt), by: v.by || '', value: v.value }));
}

// An earlier published value becomes the draft, to look at and publish
async function restore(caller, data) {
  const block = await requireBlock(data.key);
  const version = (await block.ref.collection('Versions').doc(String(data.versionId || '')).get()).data();
  if (!version) throw new ApiError('VERSION_NOT_FOUND');
  await block.ref.update({ draft: version.value, draftAt: now(), draftBy: caller.email || '' });
  return toAdmin({ ...block, draft: version.value });
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

const tools = {
  content_blocks: {
    sides: ['admin'],
    description:
      "The website's edited text blocks (homepage, About, contacts, FAQ, announcement, privacy, terms): each one's " +
      'type, draft and published value. A block not listed shows the text written in the website itself.',
    parameters: { type: 'object', properties: {} },
    run: safe(async () =>
      (await list()).map((b) => ({ ...b, draft: JSON.stringify(b.draft)?.slice(0, 1500), published: JSON.stringify(b.published)?.slice(0, 1500) })),
    ),
  },
  content_draft: {
    sides: ['admin'],
    description:
      "Proposes a new draft of a text block. key e.g. about.lead, about.faq, site.announcement; type text | markdown | " +
      'list | fields; value: a string (text, markdown), a list of objects (e.g. FAQ: [{question, answer}]) or one ' +
      'object (e.g. announcement: {text, link, active}). A draft isn\'t on the site until published. Shows a Confirm ' +
      'card; nothing changes until the admin confirms.',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string' },
        type: { type: 'string', enum: TYPES },
        markdown: { type: 'array', items: { type: 'string' }, description: 'for list/fields: the Markdown fields' },
        value: { description: 'string, list of objects, or object' },
      },
      required: ['key', 'type', 'value'],
    },
    run: safe(async (ctx, a) =>
      proposeAction(ctx, {
        action: 'content:saveDraft',
        data: { key: key(a.key), type: a.type, markdown: a.markdown || [], value: a.value },
        title: `New draft of ${a.key}`,
        lines: [String(typeof a.value === 'string' ? a.value : JSON.stringify(a.value)).slice(0, 400)],
      }),
    ),
  },
  content_publish: {
    sides: ['admin'],
    description: "Proposes publishing a block's draft on the website (the published text before is kept). Shows a Confirm card.",
    parameters: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
    run: safe(async (ctx, a) => {
      const b = await requireBlock(a.key);
      return proposeAction(ctx, {
        action: 'content:publish',
        data: { key: b.id },
        title: `Publish ${b.id} on the website`,
        lines: [String(typeof b.draft === 'string' ? b.draft : JSON.stringify(b.draft)).slice(0, 400)],
      });
    }),
  },
};

export default {
  id: 'content',
  sides: ['client', 'admin'],
  actions: {
    client: {
      'content:published': { public: true, run: () => published() },
    },
    admin: {
      'content:list': () => list(),
      'content:drafts': () => drafts(),
      'content:preview': (caller, data) => preview(data),
      'content:saveDraft': (caller, data) => saveDraft(caller, data),
      'content:publish': (caller, data) => publish(caller, data),
      'content:unpublish': (caller, data) => unpublish(caller, data),
      'content:discard': (caller, data) => discard(caller, data),
      'content:versions': (caller, data) => versions(data),
      'content:restore': (caller, data) => restore(caller, data),
    },
  },
  tools,
};
