// ==========================================================
// Core: the AI connection. Both providers speak the "chat completions"
// format (Gemini through its OpenAI-compatible endpoint), so switching is one
// value in Settings → chat (or per assistant: Settings/{side}.ai). Answers
// are streamed: onText receives the words as they are written.
// Every turn is counted in AiUsage/{day_side_model}: requests, tokens and
// failures, which the Admin Panel's AI Management turns into costs.
// ==========================================================

import { ApiError, FieldValue, db, log, today } from './app.js';

const PROVIDERS = {
  gemini: {
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    defaultModel: 'gemini-3.5-flash',
  },
  openai: {
    url: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-4.1-mini',
  },
};

// One AI turn: streams text through onText and returns the full text and any
// tool calls. side: whose assistant asked (client, lawyer, admin, test)
export async function streamTurn({ messages, tools, settings, keys, onText, side = 'client' }) {
  const providerName = String(settings.Provider || 'gemini').toLowerCase();
  const provider = PROVIDERS[providerName];
  const key = keys[providerName];
  if (!provider || !key) throw new ApiError('AI_NOT_CONFIGURED');

  const model = String(settings.Model || provider.defaultModel);
  const maxTokens = Number(settings.MaxAnswerTokens || 2000);
  const payload = { model, messages, stream: true };
  if (tools && tools.length) payload.tools = tools;
  // OpenAI sends the token counts only when asked; Gemini sends them anyway
  if (providerName === 'openai') payload.stream_options = { include_usage: true };

  if (providerName === 'gemini') {
    payload.max_tokens = maxTokens;
    payload.temperature = Number(settings.Temperature ?? 0.3);
    payload.reasoning_effort = String(settings.ReasoningEffort || 'low');
  } else {
    payload.max_completion_tokens = maxTokens;
    // Reasoning models (o-series, gpt-5) don't accept a temperature
    if (!/^(o\d|gpt-5)/.test(model)) payload.temperature = Number(settings.Temperature ?? 0.3);
  }

  // "Busy" answers (429, 500, 503) are usually brief: try twice more before giving up
  let res;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(attempt * 2000);
    res = await fetch(provider.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify(payload),
    });
    if (![429, 500, 503].includes(res.status)) break;
    console.warn(`${providerName} busy (${res.status}), retrying`);
  }

  if (!res.ok) {
    console.error(`${providerName} ${res.status}: ${await res.text()}`);
    await countUsage({ side, provider: providerName, model, failed: true });
    throw new ApiError('AI_UNAVAILABLE');
  }

  // Server-sent events: "data: {json}" lines, ending with "data: [DONE]"
  let content = '';
  let usage = null;
  const calls = [];
  const decoder = new TextDecoder();
  let buffer = '';

  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      const text = line.trim();
      if (!text.startsWith('data:')) continue;
      const data = text.slice(5).trim();
      if (!data || data === '[DONE]') continue;

      let event;
      try {
        event = JSON.parse(data);
      } catch {
        continue;
      }
      // The last event carries the token counts
      if (event.usage) usage = event.usage;
      const delta = event.choices?.[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        content += delta.content;
        onText(delta.content);
      }

      // Tool calls arrive in pieces: the name first, the arguments bit by bit
      (delta.tool_calls || []).forEach((piece, i) => {
        const index = piece.index ?? i;
        const call = (calls[index] ||= {
          id: '',
          type: 'function',
          function: { name: '', arguments: '' },
        });
        if (piece.id) call.id = piece.id;
        if (piece.function?.name) call.function.name += piece.function.name;
        if (piece.function?.arguments) call.function.arguments += piece.function.arguments;
        // Gemini's "thought signature" must be sent back with the call
        if (piece.extra_content) call.extra_content = piece.extra_content;
      });
    }
  }

  const toolCalls = calls.filter(Boolean).map((c, i) => ({ ...c, id: c.id || 'call_' + i }));
  await countUsage({
    side,
    provider: providerName,
    model,
    promptTokens: Number(usage?.prompt_tokens) || 0,
    completionTokens: Number(usage?.completion_tokens) || 0,
  });
  return { content, toolCalls };
}

// ---------- Usage ----------

// One line per day, assistant and model; a failed count never breaks the answer
async function countUsage({ side, provider, model, promptTokens = 0, completionTokens = 0, failed = false }) {
  const id = `${today()}_${side}_${model}`.replace(/[^A-Za-z0-9_.-]/g, '-');
  try {
    await db.doc('AiUsage/' + id).set(
      {
        date: today(),
        side,
        provider,
        model,
        requests: FieldValue.increment(1),
        failures: FieldValue.increment(failed ? 1 : 0),
        promptTokens: FieldValue.increment(promptTokens),
        completionTokens: FieldValue.increment(completionTokens),
      },
      { merge: true },
    );
  } catch (err) {
    await log('ai usage', err);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
