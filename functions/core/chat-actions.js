// ==========================================================
// Core: actions the chat proposes and the person confirms
// The AI never changes anything by itself. A tool that would change data
// or send something calls proposeAction(): the proposal is kept in
// ChatActions/{id} and shown as a card with Confirm / Cancel. Confirm runs
// the very same door action a button would (same side, same permissions,
// same checks), as the person who confirms, once.
// ChatActions/{id}: side, ownerId (uid), conversationId, action, data,
// title, lines, danger, status (pending | done | failed | cancelled),
// result / error, createdAt, doneAt
// ==========================================================

import { ApiError, db, now } from './app.js';
import { addPart } from './chat.js';

const actions = () => db.collection('ChatActions');

// action: the door action to run on Confirm ('declarations:setStatus' …);
// title + lines: what the card says will happen; danger: deleting and the like
export async function proposeAction(ctx, { action, data, title, lines = [], danger = false }) {
  const ref = actions().doc();
  const record = {
    side: ctx.side,
    ownerId: ctx.caller.uid || ctx.caller.ownerId,
    conversationId: ctx.conversationId || '',
    action,
    data,
    title,
    lines,
    danger,
    status: 'pending',
    createdAt: now(),
  };
  await ref.set(record);
  addPart(ctx, { type: 'action', actionId: ref.id, title, lines, danger });
  return {
    proposed: true,
    shownToUser: 'a card with Confirm / Cancel',
    note: 'Nothing has changed yet: tell them to check the card and press Confirm.',
  };
}

// Door routes: chat:confirmAction, chat:cancelAction, chat:actionStatus.
// routes: the door's own action table, so a confirmed action runs exactly
// as its button would.
export function actionRoutes(side, routes) {
  async function own(caller, data) {
    const snap = await actions().doc(String(data.actionId || '')).get();
    const a = snap.data();
    if (!a || a.side !== side || a.ownerId !== (caller.uid || caller.ownerId)) throw new ApiError('ACTION_NOT_FOUND');
    return { ref: snap.ref, ...a };
  }
  const state = (a) => ({ status: a.status, result: a.result ?? null, error: a.error ?? '' });

  return {
    'chat:confirmAction': {
      guest: true,
      run: async (caller, data, env, body) => {
        const a = await own(caller, data);
        if (a.status !== 'pending') return state(a);
        // Claimed first, so a double click can't run it twice
        const claimed = await db.runTransaction(async (t) => {
          const fresh = (await t.get(a.ref)).data();
          if (fresh.status !== 'pending') return false;
          t.update(a.ref, { status: 'running' });
          return true;
        });
        if (!claimed) return state((await a.ref.get()).data());
        const route = routes[a.action];
        try {
          if (!route) throw new ApiError('UNKNOWN_ACTION');
          if (!caller.signedIn && !route.guest) throw new ApiError('AUTH_REQUIRED');
          const run = typeof route === 'function' ? route : route.run;
          const result = await run(caller, a.data || {}, env, body);
          // Only a short, plain copy of the result is kept
          const kept = JSON.parse(JSON.stringify(result ?? null) || 'null');
          await a.ref.update({ status: 'done', result: kept, doneAt: now() });
          return { status: 'done', result: kept, error: '' };
        } catch (err) {
          await a.ref.update({ status: 'failed', error: err.code || 'SERVER_ERROR', doneAt: now() });
          return { status: 'failed', result: null, error: err.code || 'SERVER_ERROR' };
        }
      },
    },
    'chat:cancelAction': {
      guest: true,
      run: async (caller, data) => {
        const a = await own(caller, data);
        if (a.status === 'pending') {
          await a.ref.update({ status: 'cancelled', doneAt: now() });
          return { status: 'cancelled', result: null, error: '' };
        }
        return state(a);
      },
    },
    'chat:actionStatus': { guest: true, run: async (caller, data) => state(await own(caller, data)) },
  };
}
