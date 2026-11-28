// ==========================================================
// Plugin: blog (client + admin)
// Client (public):  getPosts, getPost — published posts only
// Admin:            blog:list, blog:get, blog:save, blog:cover, blog:delete —
//                   the admin blog editor (posts are written in Markdown);
//                   blog:preview shows the body as the site will
// Blog/{slug}: title, deck, body (Markdown), author, category, tags,
// featured, cover (a Storage path), status draft/scheduled/published,
// publishedAt. A scheduled post appears on its publishedAt time by itself:
// the public reads count it as published from then on.
// ==========================================================

import { ApiError, cleanText, db, formatDate, iso, now, slugify, toDate } from '../../core/app.js';
import { publicUrl, savePicture } from '../../core/files.js';
import { toHtml } from '../../core/markdown.js';
import { docs } from '../../core/records.js';

const STATUSES = ['draft', 'scheduled', 'published'];

async function toPost(p, withContent) {
  const text = String(p.body || '');
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const post = {
    slug: p.id,
    title: p.title || '',
    author: p.author || 'AI Law Editorial Team',
    date: formatDate(p.publishedAt || p.createdAt),
    category: p.category || 'Insights',
    deck: p.deck || '',
    image: p.cover ? await publicUrl(p.cover) : '',
    featured: p.featured === true,
    tags: p.tags || [],
    readTimeMinutes: Math.max(1, Math.ceil(words / 210)),
    searchText: text.replace(/[#*_>`[\]()-]/g, ' ').replace(/\s+/g, ' ').slice(0, 5000),
  };
  if (withContent) post.content = toHtml(text);
  return post;
}

// Published, or scheduled for a time that has come
const isLive = (p) =>
  p.status === 'published' || (p.status === 'scheduled' && !!toDate(p.publishedAt) && toDate(p.publishedAt) <= new Date());

async function posts() {
  const snap = await db.collection('Blog').where('status', 'in', ['published', 'scheduled']).get();
  const list = await Promise.all(docs(snap).filter(isLive).map((p) => toPost(p, false)));
  return list.sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
}

async function post(slug) {
  if (!/^[\p{L}\p{N}-]{1,120}$/u.test(String(slug || ''))) throw new ApiError('Invalid article slug.');
  const snap = await db.doc('Blog/' + slug).get();
  if (!snap.exists || !isLive(snap.data())) throw new ApiError('Article not found.');
  return toPost({ id: snap.id, ...snap.data() }, true);
}

// ---------- Admin ----------

async function adminList() {
  return docs(await db.collection('Blog').get())
    .map((p) => ({
      slug: p.id,
      title: p.title,
      category: p.category || '',
      featured: p.featured === true,
      status: p.status,
      publishedAt: iso(p.publishedAt),
      updatedAt: iso(p.updatedAt),
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function save(data) {
  const slug = slugify(data.slug || data.title);
  if (!slug) throw new ApiError('INVALID_SLUG');
  const ref = db.doc('Blog/' + slug);
  const old = (await ref.get()).data() || {};
  const status = STATUSES.includes(data.status) ? data.status : 'draft';
  // A scheduled post needs its time: "2026-12-05T09:00", Tbilisi time
  let scheduledAt = null;
  if (status === 'scheduled') {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(data.publishAt || ''))) throw new ApiError('PUBLISH_TIME_REQUIRED');
    scheduledAt = new Date(data.publishAt + ':00+04:00');
  }
  const record = {
    slug,
    title: cleanText(data.title, 200),
    deck: cleanText(data.deck, 500),
    body: String(data.body || '').slice(0, 200000),
    author: cleanText(data.author || 'AI Law Editorial Team', 120),
    category: cleanText(data.category || 'Insights', 80),
    tags: (Array.isArray(data.tags) ? data.tags : String(data.tags || '').split(','))
      .map((t) => String(t).trim())
      .filter(Boolean),
    featured: data.featured === true,
    cover: old.cover || '',
    status,
    publishedAt:
      status === 'scheduled'
        ? scheduledAt
        : status === 'published'
          ? (old.status !== 'scheduled' && old.publishedAt) || now()
          : old.publishedAt || null,
    createdAt: old.createdAt || now(),
    updatedAt: now(),
  };
  await ref.set(record);
  return { slug, status };
}

// Everything the editor needs for one post
async function adminGet(slug) {
  const snap = await db.doc('Blog/' + slugify(slug)).get();
  if (!snap.exists) throw new ApiError('NOT_FOUND');
  const p = snap.data();
  return {
    slug: snap.id,
    title: p.title || '',
    deck: p.deck || '',
    body: p.body || '',
    author: p.author || '',
    category: p.category || '',
    tags: (p.tags || []).join(', '),
    featured: p.featured === true,
    status: p.status || 'draft',
    cover: p.cover ? await publicUrl(p.cover) : '',
    publishedAt: iso(p.publishedAt),
    updatedAt: iso(p.updatedAt),
  };
}

async function saveCover(data) {
  const slug = slugify(data.slug);
  const ref = db.doc('Blog/' + slug);
  if (!slug || !(await ref.get()).exists) throw new ApiError('SAVE_THE_POST_FIRST');
  const cover = await savePicture(`blog/${slug}/cover`, data.file);
  await ref.update({ cover, updatedAt: now() });
  return adminGet(slug);
}

export default {
  id: 'blog',
  sides: ['client', 'admin'],
  actions: {
    client: {
      getPosts: { public: true, run: () => posts() },
      getPost: { public: true, run: (_, data) => post(data.slug) },
    },
    admin: {
      'blog:list': () => adminList(),
      'blog:get': (caller, data) => adminGet(data.slug),
      'blog:save': (caller, data) => save(data),
      'blog:cover': (caller, data) => saveCover(data),
      'blog:preview': (caller, data) => ({ html: toHtml(String(data.body || '').slice(0, 200000)) }),
      'blog:delete': async (caller, data) => {
        await db.doc('Blog/' + slugify(data.slug)).delete();
        return { deleted: true };
      },
    },
  },
};
