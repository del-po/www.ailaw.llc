// ==========================================================
// Core: files
//   - Storage folders: a folder is a path prefix; an empty ".keep" file
//     makes it exist before anything is put in it
//   - save, list, read; pictures uploaded from admin pages
//   - PDF: turns simple blocks (title, heading, paragraph, table, page break)
//     into a PDF, with DejaVu Sans so Georgian and symbols like № print
// ==========================================================

import PDFDocument from 'pdfkit';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ApiError, bucket } from './app.js';

const FONT = fileURLToPath(new URL('../assets/DejaVuSans.ttf', import.meta.url));
const FONT_BOLD = fileURLToPath(new URL('../assets/DejaVuSans-Bold.ttf', import.meta.url));
const KEEP = '.keep';

// ---------- Storage ----------

export async function makeFolder(path) {
  await bucket().file(join(path, KEEP)).save('', { contentType: 'text/plain', resumable: false });
  return path;
}

export async function saveFile(path, content, contentType) {
  await bucket().file(path).save(content, { contentType, resumable: false });
  return path;
}

export async function readFile(path) {
  const file = bucket().file(path);
  const [exists] = await file.exists();
  if (!exists) return null;
  const [[content], [meta]] = await Promise.all([file.download(), file.getMetadata()]);
  return { content, contentType: meta.contentType || 'application/octet-stream', size: Number(meta.size) };
}

export async function exists(path) {
  const [found] = await bucket().file(path).exists();
  return found;
}

// Folders and files directly inside path
export async function listFolder(path) {
  const prefix = path.endsWith('/') ? path : path + '/';
  const [files, , response] = await bucket().getFiles({
    prefix,
    delimiter: '/',
    autoPaginate: false,
    maxResults: 1000,
  });
  const folders = (response?.prefixes || []).map((p) => ({
    name: p.slice(prefix.length, -1),
    path: p.slice(0, -1),
  }));
  return {
    folders,
    files: files
      .filter((f) => !f.name.endsWith('/' + KEEP) && f.name !== prefix)
      .map((f) => ({
        name: f.name.slice(prefix.length),
        path: f.name,
        size: Number(f.metadata.size || 0),
        contentType: f.metadata.contentType || 'application/octet-stream',
        updatedAt: f.metadata.updated || '',
      })),
  };
}

// When a folder was made (its .keep file), or ''
export async function folderTime(path) {
  try {
    const [meta] = await bucket().file(join(path, KEEP)).getMetadata();
    return meta.timeCreated || '';
  } catch {
    return '';
  }
}

// A picture sent from an admin page as { type, data (base64) }, saved as
// base + its extension; anything else than a JPEG, PNG or WebP under 5 MB is refused
const PICTURES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

export async function savePicture(base, upload) {
  const type = String(upload?.type || '').toLowerCase();
  if (!PICTURES[type]) throw new ApiError('INVALID_FILE_TYPE');
  const content = Buffer.from(String(upload.data || ''), 'base64');
  if (!content.length) throw new ApiError('INVALID_FILE');
  if (content.length > 5 * 1024 * 1024) throw new ApiError('FILE_TOO_LARGE');
  // A new name each time, so browsers don't keep showing the old picture
  const path = `${base}-${Date.now().toString(36)}${PICTURES[type]}`;
  await saveFile(path, content, type);
  return path;
}

// A link anyone can open (for public pictures such as blog covers): a
// download token on the file, the way Firebase's own upload links work
export async function publicUrl(path) {
  const file = bucket().file(path);
  const [meta] = await file.getMetadata();
  let token = String(meta.metadata?.firebaseStorageDownloadTokens || '').split(',')[0];
  if (!token) {
    token = randomUUID();
    await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: token } });
  }
  return `https://firebasestorage.googleapis.com/v0/b/${file.bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
}

export async function removeFolder(path) {
  await bucket().deleteFiles({ prefix: path.endsWith('/') ? path : path + '/' });
}

// Moves everything inside from/ to to/ (Storage has no real folders, so
// each file is copied and the original deleted)
export async function moveFolder(from, to) {
  const prefix = from.endsWith('/') ? from : from + '/';
  const [files] = await bucket().getFiles({ prefix });
  for (const file of files) {
    await file.move(join(to, file.name.slice(prefix.length)));
  }
  return to;
}

export const join = (...parts) =>
  parts
    .map((p) => String(p).replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');

// ---------- PDF ----------

// blocks: { title } { heading } { text } { table: rows, bold: [row numbers] } { pageBreak: true }
export function buildPdf(blocks) {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: 'A4', margins: { top: 56, bottom: 56, left: 64, right: 64 } });
    const chunks = [];
    pdf.on('data', (c) => chunks.push(c));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
    pdf.registerFont('body', FONT);
    pdf.registerFont('bold', FONT_BOLD);
    const width = pdf.page.width - 128;

    for (const b of blocks) {
      if (b.pageBreak) {
        pdf.addPage();
      } else if (b.title) {
        pdf.font('bold').fontSize(14).text(b.title, { align: 'center' }).moveDown(0.8);
      } else if (b.heading) {
        pdf.moveDown(0.4).font('bold').fontSize(11).text(b.heading).moveDown(0.3);
      } else if (b.text !== undefined) {
        pdf.font('body').fontSize(10).text(b.text, { align: 'justify' }).moveDown(0.4);
      } else if (b.table) {
        table(pdf, b.table, b.bold || [], width, b.widths);
      }
    }
    pdf.end();
  });
}

// A plain table: columns share the width (or b.widths, as fractions)
function table(pdf, rows, boldRows, width, widths) {
  const columns = rows[0].length;
  const sizes = (widths || Array(columns).fill(1 / columns)).map((w) => w * width);
  const left = pdf.page.margins.left;
  pdf.fontSize(9);

  rows.forEach((row, r) => {
    pdf.font(boldRows.includes(r) ? 'bold' : 'body');
    const height =
      Math.max(...row.map((cell, c) => pdf.heightOfString(String(cell), { width: sizes[c] - 8 }))) + 6;
    if (pdf.y + height > pdf.page.height - pdf.page.margins.bottom) pdf.addPage();
    const top = pdf.y;
    let x = left;
    row.forEach((cell, c) => {
      pdf.text(String(cell), x + 4, top + 3, { width: sizes[c] - 8 });
      x += sizes[c];
    });
    pdf.moveTo(left, top + height).lineTo(left + width, top + height).lineWidth(0.5).strokeColor('#BBBBBB').stroke();
    pdf.x = left;
    pdf.y = top + height;
  });
  pdf.moveDown(0.6);
}
