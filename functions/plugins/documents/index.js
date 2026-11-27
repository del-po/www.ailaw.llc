// ==========================================================
// Plugin: documents (client)
// The profile's Documents page: a signed-in client browses their own
// Storage folder like Drive (year folders, order folders, files) and
// downloads files through the door, so no storage link is ever shown.
// folderId and fileId are paths inside the client's folder; anything
// outside it, and every "Internal" folder (lawyers' work), is refused.
// ==========================================================

import { ApiError, db, iso } from '../../core/app.js';
import { folderTime, join, listFolder, readFile } from '../../core/files.js';
import { clientByUid, docs } from '../../core/records.js';

const INTERNAL = 'Internal';
const MAX_BYTES = 25 * 1024 * 1024;

async function root(caller) {
  const client = await clientByUid(caller.uid);
  if (!client?.folder || client.folder.startsWith('drive:')) throw new ApiError('NO_DOCUMENTS_FOLDER');
  return client.folder;
}

// A path inside the client's folder → its parts, or an error
function inside(path, code) {
  const parts = String(path || '').split('/').filter(Boolean);
  if (parts.some((p) => p === '..' || p === '.' || p === INTERNAL || p.length > 200)) throw new ApiError(code);
  return parts;
}

async function getFolder(caller, data) {
  const base = await root(caller);
  const parts = inside(data.folderId, 'FOLDER_NOT_FOUND');
  const path = join(base, ...parts);
  const content = await listFolder(path);
  if (parts.length && !content.folders.length && !content.files.length && !(await folderTime(path))) {
    throw new ApiError('FOLDER_NOT_FOUND');
  }

  // Order folders get their order's number and statuses
  const orders = {};
  docs(await db.collection('Orders').where('userId', '==', caller.uid).get()).forEach((o) => {
    if (o.folder) orders[o.folder] = { orderNumber: o.orderNumber, orderStatus: o.orderStatus, paymentStatus: o.paymentStatus };
  });

  const folders = [];
  for (const f of content.folders) {
    if (f.name === INTERNAL) continue;
    folders.push({
      folderId: join(...parts, f.name),
      name: f.name,
      updatedAt: await folderTime(f.path),
      ...(orders[f.path] ? { order: orders[f.path] } : {}),
    });
  }
  // Year folders newest first; everything else by name, newest dates first
  folders.sort((a, b) => b.name.localeCompare(a.name));

  return {
    folderId: parts.join('/'),
    path: [
      { folderId: '', name: 'Documents' },
      ...parts.map((name, i) => ({ folderId: parts.slice(0, i + 1).join('/'), name })),
    ],
    order: orders[path] || null,
    folders,
    files: content.files
      .map((f) => ({
        fileId: join(...parts, f.name),
        name: f.name,
        mimeType: f.contentType,
        size: f.size,
        updatedAt: iso(f.updatedAt),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

async function getDocument(caller, data) {
  const base = await root(caller);
  const parts = inside(data.fileId, 'DOCUMENT_NOT_FOUND');
  if (!parts.length) throw new ApiError('DOCUMENT_NOT_FOUND');
  const file = await readFile(join(base, ...parts));
  if (!file) throw new ApiError('DOCUMENT_NOT_FOUND');
  if (file.size > MAX_BYTES) throw new ApiError('DOCUMENT_TOO_LARGE');
  return { name: parts[parts.length - 1], mimeType: file.contentType, data: file.content.toString('base64') };
}

export default {
  id: 'documents',
  sides: ['client'],
  actions: {
    client: {
      getFolder: (caller, data) => getFolder(caller, data),
      getDocument: (caller, data) => getDocument(caller, data),
    },
  },
};
