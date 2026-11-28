// ==========================================================
// Plugin: AI desk (admin)
// The Admin Panel's AI Management:
//   ai:get            the shared model settings (Settings/chat), each
//                     assistant's own (Settings/{side}.ai) and instructions,
//                     every plugin, and the prices per model
//   ai:setModel       the shared settings (side ''), or one assistant's
//   ai:setInstructions  one assistant's instructions; the ones replaced are
//                     kept (Settings/{side}/Versions)
//   ai:setPlugin      a plugin on or off, and which assistants use it
//   ai:setKnowledge   a plugin's know-how items; the ones replaced are kept
//                     (Plugins/{id}/Versions)
//   ai:versions, ai:restore  the kept versions of instructions or know-how
//   ai:test           one question to an assistant with its instructions and
//                     know-how (or draft instructions), without tools: nothing
//                     is saved and nothing can change
//   ai:usage          requests, tokens and cost per day, assistant and model
//                     (AiUsage, counted by core/ai.js)
//   ai:setPrices      what each model costs, per million tokens (USD)
//   ai:mistakes, ai:flag, ai:resolveMistake  answers marked wrong
//                     (AiMistakes/{id}), to look into and settle
// Switching a plugin's code version stays in Firestore (Plugins/{id}.version).
// ==========================================================

import { ApiError, cleanKey, cleanText, db, iso, now } from '../../core/app.js';
import { streamTurn } from '../../core/ai.js';
import { proposeAction } from '../../core/chat-actions.js';
import { pluginRecords } from '../../core/loader.js';
import { docs, forget, setting } from '../../core/records.js';

export const SIDES = ['client', 'lawyer', 'admin'];
const PROVIDERS = ['gemini', 'openai'];
const EFFORTS = ['low', 'medium', 'high'];
const VERSIONS_KEPT = 30;
const DAY_TEXT = /^\d{4}-\d{2}-\d{2}$/;

// The shared settings (Settings/chat values) this page edits, with their checks
const SHARED = {
  Provider: (v) => (PROVIDERS.includes(v) ? v : bad()),
  Model: (v) => cleanText(v, 80, 'INVALID_SETTING'),
  MaxAnswerTokens: (v) => number(v, 100, 32000),
  Temperature: (v) => number(v, 0, 2),
  ReasoningEffort: (v) => (EFFORTS.includes(v) ? v : bad()),
  HistoryMessages: (v) => number(v, 0, 100),
  GuestQuestionsPerDay: (v) => number(v, 0, 1000),
  UserQuestionsPerDay: (v) => number(v, 0, 1000),
};
// What one assistant may set for itself
const OWN = ['Provider', 'Model', 'MaxAnswerTokens', 'Temperature', 'ReasoningEffort'];

function bad() {
  throw new ApiError('INVALID_SETTING');
}

function number(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) bad();
  return n;
}

const side = (value) => (SIDES.includes(value) ? value : bad());

// ---------- Reading ----------

async function overview() {
  forget('setting:chat');
  forget('plugins');
  const [chat, prices, plugins, ...doors] = await Promise.all([
    setting('chat'),
    setting('aiPrices'),
    pluginRecords(),
    ...SIDES.map((s) => (forget('setting:' + s), setting(s))),
  ]);
  const values = chat.values || {};
  return {
    shared: Object.fromEntries(Object.keys(SHARED).map((k) => [k, values[k] ?? ''])),
    assistants: SIDES.map((s, i) => ({
      side: s,
      ai: Object.fromEntries(OWN.map((k) => [k, doors[i].ai?.[k] ?? ''])),
      instructions: (doors[i].instructions || []).map(instruction),
    })),
    plugins: Object.values(plugins)
      .filter((p) => p.id !== '_template')
      .map((p) => ({
        id: p.id,
        enabled: p.enabled !== false,
        sides: p.sides || [],
        kind: p.kind || 'general',
        menu: p.menu || '',
        version: p.version || '',
        items: (p.items || []).map(item),
        steps: (p.steps || []).length,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    prices: prices.models || {},
  };
}

const instruction = (i, n) => ({
  title: String(i.title || ''),
  text: String(i.text || ''),
  order: Number(i.order ?? n + 1),
  active: i.active !== false,
});

const item = (i) => ({
  title: String(i.title || ''),
  text: String(i.text || ''),
  audience: Array.isArray(i.audience) ? i.audience.filter((a) => SIDES.includes(a)) : [],
  active: i.active !== false,
});

// ---------- Versions ----------

// The record as it was, kept before a change; only the latest ones stay
async function keep(ref, field, value, caller) {
  const versions = ref.collection('Versions');
  await versions.add({ field, value: value ?? [], savedAt: now(), by: caller.email || '' });
  const old = await versions.orderBy('savedAt', 'desc').offset(VERSIONS_KEPT).get();
  await Promise.all(old.docs.map((d) => d.ref.delete()));
}

// Instructions of an assistant (side) or know-how of a plugin (pluginId)
function owner(data) {
  if (data.pluginId) return { ref: db.doc('Plugins/' + cleanKey(data.pluginId)), field: 'items', cache: 'plugins' };
  const s = side(data.side);
  return { ref: db.doc('Settings/' + s), field: 'instructions', cache: 'setting:' + s };
}

async function versions(data) {
  const { ref } = owner(data);
  const snap = await ref.collection('Versions').orderBy('savedAt', 'desc').limit(VERSIONS_KEPT).get();
  return docs(snap).map((v) => ({
    id: v.id,
    savedAt: iso(v.savedAt),
    by: v.by || '',
    count: (v.value || []).length,
    value: v.value || [],
  }));
}

async function restore(caller, data) {
  const { ref, field, cache } = owner(data);
  const version = (await ref.collection('Versions').doc(cleanKey(data.versionId)).get()).data();
  if (!version || version.field !== field) throw new ApiError('VERSION_NOT_FOUND');
  await keep(ref, field, (await ref.get()).data()?.[field], caller);
  await ref.set({ [field]: version.value }, { merge: true });
  forget(cache);
  return overview();
}

// ---------- Changing ----------

async function setModel(data) {
  const values = data.values && typeof data.values === 'object' ? data.values : {};
  if (!data.side) {
    const changes = {};
    for (const [key, check] of Object.entries(SHARED)) {
      if (values[key] !== undefined && values[key] !== '') changes['values.' + key] = check(values[key]);
    }
    if (!Object.keys(changes).length) throw new ApiError('NOTHING_TO_CHANGE');
    await db.doc('Settings/chat').update(changes);
    forget('setting:chat');
  } else {
    const s = side(data.side);
    // An empty value means "use the shared one"
    const ai = {};
    for (const key of OWN) {
      if (values[key] !== undefined && values[key] !== '') ai[key] = SHARED[key](values[key]);
    }
    // The record may not exist yet; then the whole map is replaced, so a
    // cleared value really goes
    await db.doc('Settings/' + s).set({}, { merge: true });
    await db.doc('Settings/' + s).update({ ai });
    forget('setting:' + s);
  }
  return overview();
}

function cleanInstructions(list) {
  if (!Array.isArray(list) || list.length > 50) throw new ApiError('INVALID_INSTRUCTIONS');
  return list.map((i, n) => ({
    title: cleanText(i?.title, 120, 'INVALID_INSTRUCTIONS'),
    text: cleanText(i?.text, 20000, 'INVALID_INSTRUCTIONS'),
    order: n + 1,
    active: i?.active !== false,
  }));
}

async function setInstructions(caller, data) {
  const s = side(data.side);
  const instructions = cleanInstructions(data.instructions);
  const ref = db.doc('Settings/' + s);
  await keep(ref, 'instructions', (await ref.get()).data()?.instructions, caller);
  await ref.set({ instructions }, { merge: true });
  forget('setting:' + s);
  return overview();
}

async function setPlugin(data) {
  const ref = db.doc('Plugins/' + cleanKey(data.pluginId));
  if (!(await ref.get()).exists) throw new ApiError('PLUGIN_NOT_FOUND');
  const changes = {};
  if (typeof data.enabled === 'boolean') changes.enabled = data.enabled;
  if (Array.isArray(data.sides)) changes.sides = data.sides.filter((x) => SIDES.includes(x));
  if (!Object.keys(changes).length) throw new ApiError('NOTHING_TO_CHANGE');
  await ref.update(changes);
  forget('plugins');
  return overview();
}

async function setKnowledge(caller, data) {
  const ref = db.doc('Plugins/' + cleanKey(data.pluginId));
  const record = (await ref.get()).data();
  if (!record) throw new ApiError('PLUGIN_NOT_FOUND');
  if (!Array.isArray(data.items) || data.items.length > 200) throw new ApiError('INVALID_KNOWLEDGE');
  const items = data.items.map((i) => ({
    title: cleanText(i?.title, 200, 'INVALID_KNOWLEDGE'),
    text: cleanText(i?.text, 50000, 'INVALID_KNOWLEDGE'),
    audience: (Array.isArray(i?.audience) ? i.audience : []).filter((a) => SIDES.includes(a)),
    active: i?.active !== false,
  }));
  await keep(ref, 'items', record.items, caller);
  await ref.update({ items });
  forget('plugins');
  return overview();
}

// ---------- Testing ----------

// The assistant's instructions (or a draft of them) and the know-how its
// general plugins give it; service plugins only come in with their service
async function testPrompt(s, draft) {
  const door = await setting(s);
  const list = draft ? cleanInstructions(draft) : (door.instructions || []).map(instruction);
  const parts = list
    .filter((i) => i.active && i.text)
    .sort((a, b) => a.order - b.order)
    .map((i) => `## ${i.title}\n${i.text}`);
  for (const p of Object.values(await pluginRecords())) {
    if (p.enabled === false || p.kind === 'service' || !(p.sides || []).includes(s)) continue;
    (p.items || [])
      .filter((i) => i.active !== false && (i.audience || []).includes(s) && i.text)
      .forEach((i) => parts.push(`## ${i.title}\n${i.text}`));
  }
  return parts.join('\n\n');
}

async function test(data, env) {
  const s = side(data.side);
  const question = cleanText(data.question, 4000, 'INVALID_INPUT');
  if (!question) throw new ApiError('INVALID_INPUT');
  const prompt = await testPrompt(s, data.instructions);
  // Draft model settings may be tried too, with the same checks as saving them
  const draft = {};
  for (const key of OWN) {
    if (data.ai?.[key] !== undefined && data.ai[key] !== '') draft[key] = SHARED[key](data.ai[key]);
  }
  const settings = { ...((await setting('chat')).values || {}), ...((await setting(s)).ai || {}), ...draft };
  const started = Date.now();
  const { content } = await streamTurn({
    messages: [
      { role: 'system', content: prompt + '\n\n## Context\nThis is a test from the Admin Panel. You have no tools.' },
      { role: 'user', content: question },
    ],
    tools: [],
    settings,
    keys: env.keys,
    onText: () => {},
    side: 'test',
  });
  return {
    answer: content,
    promptCharacters: prompt.length,
    model: settings.Model || '(provider default)',
    provider: settings.Provider || 'gemini',
    seconds: Math.round((Date.now() - started) / 100) / 10,
  };
}

// ---------- Usage and cost ----------

function period(data) {
  const to = DAY_TEXT.test(data.to || '') ? data.to : new Date().toISOString().slice(0, 10);
  const from = DAY_TEXT.test(data.from || '') ? data.from : new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  return { from, to };
}

// USD for one usage line, from the prices per million tokens
export function costOf(line, prices) {
  const p = prices[line.model];
  if (!p) return null;
  return (Number(line.promptTokens || 0) * Number(p.input || 0) + Number(line.completionTokens || 0) * Number(p.output || 0)) / 1e6;
}

export async function usageLines(data) {
  const p = period(data);
  const snap = await db.collection('AiUsage').where('date', '>=', p.from).where('date', '<=', p.to).get();
  return docs(snap);
}

async function usage(data) {
  const prices = (await setting('aiPrices')).models || {};
  const lines = (await usageLines(data)).map((l) => ({
    date: l.date,
    side: l.side,
    provider: l.provider,
    model: l.model,
    requests: Number(l.requests || 0),
    failures: Number(l.failures || 0),
    promptTokens: Number(l.promptTokens || 0),
    completionTokens: Number(l.completionTokens || 0),
    cost: costOf(l, prices),
  }));
  const sum = (key) => lines.reduce((n, l) => n + (l[key] || 0), 0);
  return {
    period: period(data),
    totals: {
      requests: sum('requests'),
      failures: sum('failures'),
      promptTokens: sum('promptTokens'),
      completionTokens: sum('completionTokens'),
      cost: Math.round(sum('cost') * 10000) / 10000,
      // Models used without a price: their cost isn't in the total
      unpriced: [...new Set(lines.filter((l) => l.cost === null).map((l) => l.model))],
    },
    lines: lines.sort((a, b) => b.date.localeCompare(a.date) || a.side.localeCompare(b.side)),
  };
}

async function setPrices(data) {
  const models = {};
  for (const [model, p] of Object.entries(data.prices || {}).slice(0, 50)) {
    const name = cleanText(model, 80, 'INVALID_SETTING');
    if (!name) continue;
    models[name] = { input: number(p?.input ?? 0, 0, 1000), output: number(p?.output ?? 0, 0, 1000) };
  }
  await db.doc('Settings/aiPrices').set({ models, currency: 'USD', updatedAt: now() });
  forget('setting:aiPrices');
  return overview();
}

// ---------- Mistakes ----------

async function mistakes(data) {
  const snap = await db.collection('AiMistakes').orderBy('createdAt', 'desc').limit(300).get();
  return docs(snap)
    .filter((m) => !data.status || m.status === data.status)
    .map((m) => ({
      id: m.id,
      conversationId: m.conversationId,
      messageId: m.messageId,
      side: m.side || '',
      question: m.question || '',
      answer: m.answer || '',
      note: m.note || '',
      status: m.status || 'open',
      resolution: m.resolution || '',
      by: m.by || '',
      createdAt: iso(m.createdAt),
      resolvedAt: iso(m.resolvedAt),
    }));
}

// The answer marked wrong, kept with the question before it
async function flag(caller, data) {
  const conversationId = cleanKey(data.conversationId, 'NOT_FOUND');
  const chat = (await db.doc('Chat/' + conversationId).get()).data();
  if (!chat) throw new ApiError('NOT_FOUND');
  const messages = docs(await db.collection(`Chat/${conversationId}/Messages`).orderBy('createdAt').get());
  const at = messages.findIndex((m) => m.id === String(data.messageId || ''));
  if (at < 0 || messages[at].role !== 'assistant') throw new ApiError('NOT_FOUND');
  const question = messages.slice(0, at).reverse().find((m) => m.role === 'user');
  const ref = await db.collection('AiMistakes').add({
    conversationId,
    messageId: messages[at].id,
    side: chat.side || 'client',
    question: String(question?.text || '').slice(0, 4000),
    answer: String(messages[at].text || '').slice(0, 8000),
    note: cleanText(data.note, 2000),
    status: 'open',
    resolution: '',
    by: caller.email || '',
    createdAt: now(),
  });
  await db.doc(`Chat/${conversationId}/Messages/${messages[at].id}`).update({ mistakeId: ref.id });
  return { id: ref.id };
}

async function resolve(caller, data) {
  const ref = db.doc('AiMistakes/' + cleanKey(data.id, 'NOT_FOUND'));
  if (!(await ref.get()).exists) throw new ApiError('NOT_FOUND');
  await ref.update({ status: 'resolved', resolution: cleanText(data.resolution, 2000), resolvedAt: now(), resolvedBy: caller.email || '' });
  return mistakes({});
}

// AI spending for a period, for the dashboard: { USD: n } or null when no model has a price
export async function aiSpending(data) {
  const prices = (await setting('aiPrices')).models || {};
  if (!Object.keys(prices).length) return null;
  const total = (await usageLines(data)).reduce((n, l) => n + (costOf(l, prices) || 0), 0);
  return { USD: Math.round(total * 100) / 100 };
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
  ai_settings: {
    sides: ['admin'],
    description:
      'AI Management: the shared model settings, each assistant\'s own model settings and instructions, every plugin ' +
      '(on/off, which assistants use it, its know-how items) and the prices per model.',
    parameters: { type: 'object', properties: {} },
    run: safe(async () => {
      const o = await overview();
      // Know-how texts can be long: their titles are enough here
      return { ...o, plugins: o.plugins.map((p) => ({ ...p, items: p.items.map((i) => ({ title: i.title, audience: i.audience, active: i.active })) })) };
    }),
  },
  ai_usage: {
    sides: ['admin'],
    description: 'AI requests, failures, tokens and cost (USD) for a period (from/to yyyy-MM-dd), per day, assistant and model.',
    parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } },
    run: safe(async (ctx, a) => {
      const u = await usage(a);
      return { ...u, lines: u.lines.slice(0, 60) };
    }),
  },
  ai_plugin_set: {
    sides: ['admin'],
    description:
      'Proposes switching a plugin on or off (enabled) and/or which assistants use it (sides: client, lawyer, admin). ' +
      'Shows a Confirm card; nothing changes until the admin confirms.',
    parameters: {
      type: 'object',
      properties: {
        pluginId: { type: 'string' },
        enabled: { type: 'boolean' },
        sides: { type: 'array', items: { type: 'string', enum: SIDES } },
      },
      required: ['pluginId'],
    },
    run: safe(async (ctx, a) => {
      const lines = [];
      if (typeof a.enabled === 'boolean') lines.push(a.enabled ? 'Switched on' : 'Switched off');
      if (Array.isArray(a.sides)) lines.push('Used by: ' + (a.sides.join(', ') || 'nobody'));
      if (!lines.length) return { error: 'NOTHING_TO_CHANGE' };
      return proposeAction(ctx, { action: 'ai:setPlugin', data: a, title: `Plugin ${a.pluginId}`, lines, danger: a.enabled === false });
    }),
  },
  ai_model_set: {
    sides: ['admin'],
    description:
      'Proposes model settings: side empty = shared by every assistant (Provider gemini|openai, Model, MaxAnswerTokens, ' +
      'Temperature, ReasoningEffort low|medium|high, HistoryMessages, GuestQuestionsPerDay, UserQuestionsPerDay); ' +
      'side client|lawyer|admin = that assistant\'s own Provider, Model, MaxAnswerTokens, Temperature, ' +
      'ReasoningEffort (empty = use the shared one). Shows a Confirm card; nothing changes until the admin confirms.',
    parameters: {
      type: 'object',
      properties: { side: { type: 'string' }, values: { type: 'object' } },
      required: ['values'],
    },
    run: safe(async (ctx, a) =>
      proposeAction(ctx, {
        action: 'ai:setModel',
        data: { side: a.side || '', values: a.values || {} },
        title: a.side ? `Model settings of the ${a.side} assistant` : 'Shared model settings',
        lines: Object.entries(a.values || {}).map(([k, v]) => `${k}: ${v === '' ? '(shared)' : v}`),
      }),
    ),
  },
};

export default {
  id: 'ai-desk',
  sides: ['admin'],
  actions: {
    admin: {
      'ai:get': () => overview(),
      'ai:setModel': (caller, data) => setModel(data),
      'ai:setInstructions': (caller, data) => setInstructions(caller, data),
      'ai:setPlugin': (caller, data) => setPlugin(data),
      'ai:setKnowledge': (caller, data) => setKnowledge(caller, data),
      'ai:versions': (caller, data) => versions(data),
      'ai:restore': (caller, data) => restore(caller, data),
      'ai:test': (caller, data, env) => test(data, env),
      'ai:usage': (caller, data) => usage(data),
      'ai:setPrices': (caller, data) => setPrices(data),
      'ai:mistakes': (caller, data) => mistakes(data),
      'ai:flag': (caller, data) => flag(caller, data),
      'ai:resolveMistake': (caller, data) => resolve(caller, data),
    },
  },
  tools,
};
