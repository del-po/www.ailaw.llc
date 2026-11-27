// ==========================================================
// Core: the plugin loader
// A plugin is know-how for one job. It has up to two parts:
//   1. A record in Firestore (Plugins/{id}), always:
//        enabled   on/off switch
//        sides     which doors use it: client, lawyer, admin
//        version   which code version runs, when the code has several
//        items     [{ audience: [sides], title, text }]: know-how the AI
//                  reads; each item only reaches the sides it names
//        fields    details the chat collects before ordering
//        steps     the work, copied into each order
//   2. A code folder (plugins/{id}), only when it needs its own tools,
//      actions or step types. Code with several versions exports
//      { versions: { v1: {...}, v2: {...} }, defaultVersion }.
// A plugin with no code folder (e.g. declarations) is pure data.
// ==========================================================

import { db } from './app.js';
import { cached, docs, setting } from './records.js';
import { registerCapabilities } from './steps.js';

export async function pluginRecords() {
  return cached('plugins', 60, async () => {
    const map = {};
    docs(await db.collection('Plugins').get()).forEach((p) => (map[p.id] = p));
    return map;
  });
}

// The plugins one door uses: code modules (with their records) and
// data-only records, each switched on and meant for this side
export async function loadPlugins(side, modules) {
  const records = await pluginRecords();
  const loaded = [];
  const withCode = new Set();

  for (const raw of modules) {
    const record = records[raw.id] || {};
    const module = raw.versions
      ? { ...raw, ...raw.versions[record.version || raw.defaultVersion] }
      : raw;
    withCode.add(raw.id);
    const sides = record.sides || module.sides || [];
    if (record.enabled === false || !sides.includes(side)) continue;
    if (module.capabilities) registerCapabilities(module.capabilities);
    loaded.push({ ...module, record });
  }

  for (const record of Object.values(records)) {
    if (withCode.has(record.id) || record.enabled === false) continue;
    if ((record.sides || []).includes(side)) loaded.push({ id: record.id, record });
  }
  return loaded;
}

// Door routes from every loaded plugin: { 'action': handler }
export function actionsOf(plugins, side) {
  const routes = {};
  plugins.forEach((p) => Object.assign(routes, p.actions?.[side] || {}));
  return routes;
}

// AI tools this side may use
export function toolsOf(plugins, side) {
  const tools = {};
  plugins.forEach((p) =>
    Object.entries(p.tools || {}).forEach(([name, tool]) => {
      if (!tool.sides || tool.sides.includes(side)) tools[name] = tool;
    }),
  );
  return tools;
}

// The instructions for one conversation: the door's own, then each
// plugin's text and the items meant for this side
export async function buildPrompt(plugins, ctx) {
  const door = await setting(ctx.side);
  const parts = [];

  const own = (door.instructions || [])
    .filter((i) => i.active !== false && i.text)
    .sort((a, b) => Number(a.order) - Number(b.order))
    .map((i) => `## ${i.title}\n${i.text}`);
  parts.push(...own);

  for (const p of plugins) {
    if (p.prompt) {
      const text = await p.prompt(ctx, p.record);
      if (text) parts.push(text);
    }
    const items = (p.record.items || []).filter(
      (i) => i.active !== false && (i.audience || []).includes(ctx.side) && i.text,
    );
    items.forEach((i) => parts.push(`## ${i.title}\n${i.text}`));
  }
  return parts.join('\n\n');
}
