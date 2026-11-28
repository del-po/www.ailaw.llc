// ==========================================================
// Core: Markdown → safe HTML, for the blog and the website's content
// Raw HTML is shown as text; "#" headings become <h2> (the page owns <h1>)
// and get an id from their text, so a page can link to its sections;
// links go to http(s) (a new tab), mailto:/tel:, or a page of this site
// ("/terms"); anything else stays plain text; pictures are left out.
// ==========================================================

import { Marked } from 'marked';
import { slugify } from './app.js';

export const escapeHtml = (text) =>
  String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const marked = new Marked({
  renderer: {
    html: ({ text }) => escapeHtml(text),
    heading({ tokens, depth }) {
      const level = Math.min(depth + 1, 4);
      const inner = this.parser.parseInline(tokens);
      const id = slugify(inner.replace(/<[^>]+>/g, ''));
      return `<h${level}${id ? ` id="${id}"` : ''}>${inner}</h${level}>\n`;
    },
    link({ href, tokens }) {
      const text = this.parser.parseInline(tokens);
      const url = String(href || '');
      if (/^https?:\/\//i.test(url)) {
        return `<a href="${escapeHtml(url)}" rel="noopener noreferrer" target="_blank">${text}</a>`;
      }
      if (/^(mailto:|tel:)/i.test(url) || /^\/(?!\/)/.test(url) || url.startsWith('#')) {
        return `<a href="${escapeHtml(url)}">${text}</a>`;
      }
      return text;
    },
    image: ({ text }) => escapeHtml(text),
  },
});

export const toHtml = (text) => marked.parse(String(text || ''));
