// ==========================================================
// Plugin: file desk (admin)
// The Admin Panel's Documents section: one explorer over everything in
// Storage (client folders with their order folders, lawyers' Internal
// folders, 1% declarations, service pictures …). Nothing is stored twice:
// these actions work on the files where they already are.
//   files:list       a folder's folders and files ('' = the top)
//   files:search     files anywhere whose path holds every word (client
//                    code or name, order number, file name), optionally
//                    changed between two days
//   files:get        one file, to download
//   files:upload     a file into a folder; a file of the same name is only
//                    replaced when asked (replace), and the old one is kept
//                    in that folder's "Versions" folder
//   files:rename     a new name, same folder
//   files:move       to another folder
//   files:newFolder  an empty folder
//   files:delete     moved to trash/<day>/<its path>, never destroyed, so it
//                    can be put back by hand
//   files:versions   the copies kept of one file
// Who uploaded, renamed or deleted what is in the audit log (core/audit.js).
// Clients never see "Internal" or "Versions" folders (plugins/documents).
// ==========================================================

import { ApiError, bucket, cleanName, formatDate, iso, toDate } from '../../core/app.js';
import { proposeAction } from '../../core/chat-actions.js';
import { exists, join, listFolder, makeFolder, readFile, saveFile } from '../../core/files.js';

export const VERSIONS = 'Versions';
const TRASH = 'trash';
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_SEARCH = 5000;
const KEEP_NAME = '.keep';

// ---------- Paths ----------

// A path from the website → its clean parts; '..' and the like are refused
function parts(path, code = 'INVALID_PATH') {
  const list = String(path || '').split('/').filter(Boolean);
  if (list.some((p) => p === '.' || p === '..' || p.length > 200 || /[\u0000-\u001F]/.test(p))) throw new ApiError(code);
  return list;
}

const pathOf = (path, code) => parts(path, code).join('/');

// A file name typed by the admin: no slashes or characters Storage paths shouldn't hold
function fileName(name) {
  const clean = cleanName(String(name || '')).slice(0, 160);
  if (!clean || clean === KEEP_NAME || clean.startsWith('.')) throw new ApiError('INVALID_NAME');
  return clean;
}

const toFile = (f) => ({
  name: f.name.split('/').pop(),
  path: f.path || f.name,
  size: Number(f.size || 0),
  contentType: f.contentType || 'application/octet-stream',
  updatedAt: iso(f.updatedAt),
});

// ---------- Reading ----------

async function list(data) {
  const path = pathOf(data.path, 'FOLDER_NOT_FOUND');
  const content = await listFolder(path);
  const crumbs = path ? path.split('/') : [];
  return {
    path,
    crumbs: [{ name: 'Storage', path: '' }, ...crumbs.map((name, i) => ({ name, path: crumbs.slice(0, i + 1).join('/') }))],
    folders: content.folders.sort((a, b) => b.name.localeCompare(a.name)),
    files: content.files.map(toFile).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

async function search(data) {
  const words = String(data.query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(data.from || '') ? new Date(data.from + 'T00:00:00+04:00') : null;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(data.to || '') ? new Date(data.to + 'T23:59:59.999+04:00') : null;
  if (!words.length && !from && !to) throw new ApiError('SEARCH_WORDS_REQUIRED');
  const prefix = data.path ? pathOf(data.path) + '/' : '';
  const [files] = await bucket().getFiles({ prefix, maxResults: MAX_SEARCH });
  return files
    .filter((f) => !f.name.endsWith('/' + KEEP_NAME) && !f.name.startsWith(TRASH + '/'))
    .map((f) => toFile({ name: f.name, path: f.name, size: f.metadata.size, contentType: f.metadata.contentType, updatedAt: f.metadata.updated }))
    .filter((f) => words.every((w) => f.path.toLowerCase().includes(w)))
    .filter((f) => {
      const when = toDate(f.updatedAt);
      return (!from || (when && when >= from)) && (!to || (when && when <= to));
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 300);
}

async function get(data) {
  const path = pathOf(data.path, 'DOCUMENT_NOT_FOUND');
  const file = await readFile(path);
  if (!file) throw new ApiError('DOCUMENT_NOT_FOUND');
  if (file.size > 25 * 1024 * 1024) throw new ApiError('DOCUMENT_TOO_LARGE');
  return { name: path.split('/').pop(), mimeType: file.contentType, data: file.content.toString('base64') };
}

async function versions(data) {
  const path = pathOf(data.path, 'DOCUMENT_NOT_FOUND');
  const folder = path.split('/').slice(0, -1);
  const name = path.split('/').pop();
  const kept = await listFolder(join(...folder, VERSIONS));
  return kept.files.filter((f) => f.name.endsWith(' - ' + name)).map(toFile).sort((a, b) => b.name.localeCompare(a.name));
}

// ---------- Changing ----------

// "2026-11-28 1530 - Agreement.pdf": the old copy of a replaced file
async function keepVersion(path) {
  const list = path.split('/');
  const name = list.pop();
  const target = join(...list, VERSIONS, `${formatDate(new Date(), 'yyyy-MM-dd HHmmss')} - ${name}`);
  await bucket().file(path).copy(bucket().file(target));
  return target;
}

export async function upload(data) {
  const folder = pathOf(data.folder);
  const file = data.file || {};
  const content = Buffer.from(String(file.data || ''), 'base64');
  if (!content.length) throw new ApiError('INVALID_FILE');
  if (content.length > MAX_BYTES) throw new ApiError('FILE_TOO_LARGE');
  const name = fileName(file.name);
  const path = join(folder, name);
  let kept = '';
  if (await exists(path)) {
    if (data.replace !== true) throw new ApiError('FILE_EXISTS');
    kept = await keepVersion(path);
  }
  await saveFile(path, content, String(file.type || 'application/octet-stream').slice(0, 120));
  return { path, name, replaced: !!kept, keptAs: kept };
}

async function moveTo(from, to) {
  if (from === to) return to;
  if (!(await exists(from))) throw new ApiError('DOCUMENT_NOT_FOUND');
  if (await exists(to)) throw new ApiError('FILE_EXISTS');
  await bucket().file(from).move(to);
  return to;
}

async function rename(data) {
  const from = pathOf(data.path, 'DOCUMENT_NOT_FOUND');
  const folder = from.split('/').slice(0, -1);
  return { path: await moveTo(from, join(...folder, fileName(data.name))) };
}

async function move(data) {
  const from = pathOf(data.path, 'DOCUMENT_NOT_FOUND');
  return { path: await moveTo(from, join(pathOf(data.folder), from.split('/').pop())) };
}

async function newFolder(data) {
  const path = join(pathOf(data.folder), fileName(data.name));
  if ((await listFolder(path)).files.length || (await exists(join(path, KEEP_NAME)))) throw new ApiError('FOLDER_EXISTS');
  return { path: await makeFolder(path) };
}

async function remove(data) {
  const from = pathOf(data.path, 'DOCUMENT_NOT_FOUND');
  if (from.startsWith(TRASH + '/')) throw new ApiError('ALREADY_DELETED');
  const to = join(TRASH, formatDate(new Date(), 'yyyy-MM-dd'), from);
  await moveTo(from, (await exists(to)) ? to.replace(/(\.[^./]+)?$/, `-${Date.now().toString(36)}$1`) : to);
  return { deleted: from };
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

const CHANGE = ' Shows a Confirm card; nothing changes until the admin confirms.';

const tools = {
  documents_search: {
    sides: ['admin'],
    description:
      'Finds documents anywhere in storage by words in their path: client code (ID-…) or name, order number (AIL-…), ' +
      'service or file name; optionally changed between two days (yyyy-MM-dd). Newest first.',
    parameters: { type: 'object', properties: { query: str('words to look for'), from: str('optional'), to: str('optional') } },
    run: safe(async (ctx, a) => (await search(a)).slice(0, 40)),
  },
  documents_folder: {
    sides: ['admin'],
    description: "One storage folder's folders and files ('' = the top: clients, trash …).",
    parameters: { type: 'object', properties: { path: str('folder path') } },
    run: safe(async (ctx, a) => {
      const f = await list(a);
      return { path: f.path, folders: f.folders.map((x) => x.path), files: f.files.slice(0, 100) };
    }),
  },
  document_rename: {
    sides: ['admin'],
    description: 'Proposes renaming a file (same folder).' + CHANGE,
    parameters: { type: 'object', properties: { path: str('file path'), name: str('new file name with extension') }, required: ['path', 'name'] },
    run: safe(async (ctx, a) =>
      proposeAction(ctx, { action: 'files:rename', data: { path: pathOf(a.path), name: fileName(a.name) }, title: 'Rename a document', lines: [a.path, '→ ' + fileName(a.name)] }),
    ),
  },
  document_move: {
    sides: ['admin'],
    description: 'Proposes moving a file to another folder.' + CHANGE,
    parameters: { type: 'object', properties: { path: str('file path'), folder: str('target folder path') }, required: ['path', 'folder'] },
    run: safe(async (ctx, a) =>
      proposeAction(ctx, { action: 'files:move', data: { path: pathOf(a.path), folder: pathOf(a.folder) }, title: 'Move a document', lines: [a.path, '→ ' + a.folder] }),
    ),
  },
  document_new_folder: {
    sides: ['admin'],
    description: 'Proposes making a new folder inside a folder.' + CHANGE,
    parameters: { type: 'object', properties: { folder: str('parent folder path'), name: str('new folder name') }, required: ['folder', 'name'] },
    run: safe(async (ctx, a) =>
      proposeAction(ctx, { action: 'files:newFolder', data: { folder: pathOf(a.folder), name: fileName(a.name) }, title: 'New folder', lines: [join(pathOf(a.folder), fileName(a.name))] }),
    ),
  },
  document_delete: {
    sides: ['admin'],
    description: 'Proposes deleting a file: it moves to the trash folder, where it can still be found.' + CHANGE,
    parameters: { type: 'object', properties: { path: str('file path') }, required: ['path'] },
    run: safe(async (ctx, a) =>
      proposeAction(ctx, { action: 'files:delete', data: { path: pathOf(a.path) }, title: 'Delete a document', lines: [a.path, 'It moves to the trash folder.'], danger: true }),
    ),
  },
};

export default {
  id: 'file-desk',
  sides: ['admin'],
  actions: {
    admin: {
      'files:list': (caller, data) => list(data),
      'files:search': (caller, data) => search(data),
      'files:get': (caller, data) => get(data),
      'files:versions': (caller, data) => versions(data),
      'files:upload': (caller, data) => upload(data),
      'files:rename': (caller, data) => rename(data),
      'files:move': (caller, data) => move(data),
      'files:newFolder': (caller, data) => newFolder(data),
      'files:delete': (caller, data) => remove(data),
    },
  },
  tools,
};
