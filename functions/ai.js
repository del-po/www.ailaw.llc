// ==========================================================
// AI providers. Both speak the "chat completions" format (Gemini through its
// OpenAI-compatible endpoint), so switching is one cell in the Settings tab.
// Answers are streamed: onText receives the words as they are written.
// ==========================================================

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

export class ApiError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

// One AI turn: streams text through onText and returns the full text and any tool calls
export async function streamTurn({ messages, tools, settings, keys, onText }) {
  const providerName = String(settings.Provider || 'gemini').toLowerCase();
  const provider = PROVIDERS[providerName];
  const key = keys[providerName];
  if (!provider || !key) throw new ApiError('AI_NOT_CONFIGURED');

  const model = String(settings.Model || provider.defaultModel);
  const maxTokens = Number(settings.MaxAnswerTokens || 2000);
  const payload = { model, messages, stream: true };
  if (tools && tools.length) payload.tools = tools;

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
    throw new ApiError('AI_UNAVAILABLE');
  }

  // Server-sent events: "data: {json}" lines, ending with "data: [DONE]"
  let content = '';
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
  return { content, toolCalls };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
