// ==========================================================
// Plugin: blog (client + admin)
// Client (public):  getPosts, getPost — published posts only
// Admin:            blog:list, blog:save, blog:delete — for the admin blog
//                   editor (posts are written in Markdown)
// Blog/{slug}: title, deck, body (Markdown), author, category, tags,
// featured, cover (a Storage path), status draft/published, publishedAt.
// ==========================================================

import { Marked } from 'marked';
import { ApiError, cleanText, db, formatDate, iso, now, slugify } from '../../core/app.js';
import { publicUrl } from '../../core/files.js';
import { docs } from '../../core/records.js';

const escapeHtml = (text) =>
  String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// Markdown → safe HTML: raw HTML is shown as text, links open in a new tab
// and only go to http(s), "#" headings become <h2> (the page owns <h1>)
const markdown = new Marked({
  renderer: {
    html: ({ text }) => escapeHtml(text),
    heading({ tokens, depth }) {
      const level = Math.min(depth + 1, 4);
      return `<h${level}>${this.parser.parseInline(tokens)}</h${level}>\n`;
    },
    link({ href, tokens }) {
      const text = this.parser.parseInline(tokens);
      return /^https?:\/\//i.test(href || '')
        ? `<a href="${escapeHtml(href)}" rel="noopener noreferrer" target="_blank">${text}</a>`
        : text;
    },
    image: ({ text }) => escapeHtml(text),
  },
});

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
  if (withContent) post.content = markdown.parse(text);
  return post;
}

async function posts() {
  const snap = await db.collection('Blog').where('status', '==', 'published').get();
  const list = await Promise.all(docs(snap).map((p) => toPost(p, false)));
  return list.sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
}

async function post(slug) {
  if (!/^[\p{L}\p{N}-]{1,120}$/u.test(String(slug || ''))) throw new ApiError('Invalid article slug.');
  const snap = await db.doc('Blog/' + slug).get();
  if (!snap.exists || snap.data().status !== 'published') throw new ApiError('Article not found.');
  return toPost({ id: snap.id, ...snap.data() }, true);
}

// ---------- Admin ----------

async function adminList() {
  return docs(await db.collection('Blog').get()).map((p) => ({
    slug: p.id,
    title: p.title,
    status: p.status,
    publishedAt: iso(p.publishedAt),
    updatedAt: iso(p.updatedAt),
  }));
}

async function save(data) {
  const slug = slugify(data.slug || data.title);
  if (!slug) throw new ApiError('INVALID_SLUG');
  const ref = db.doc('Blog/' + slug);
  const old = (await ref.get()).data() || {};
  const status = data.status === 'published' ? 'published' : 'draft';
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
    publishedAt: status === 'published' ? old.publishedAt || now() : old.publishedAt || null,
    createdAt: old.createdAt || now(),
    updatedAt: now(),
  };
  await ref.set(record);
  return { slug, status };
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
      'blog:save': (caller, data) => save(data),
      'blog:delete': async (caller, data) => {
        await db.doc('Blog/' + slugify(data.slug)).delete();
        return { deleted: true };
      },
    },
  },
};
