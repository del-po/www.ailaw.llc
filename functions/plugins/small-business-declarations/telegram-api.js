// ==========================================================
// Small business declarations: the Telegram Bot API
// The few calls the bot needs. The bot's token is the secret
// DECLARATIONS_BOT_TOKEN; it never appears in the code.
// ==========================================================

const api = (token, method) => `https://api.telegram.org/bot${token}/${method}`;

async function call(token, method, payload) {
  const res = await fetch(api(token, method), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!body.ok) throw new Error(`Telegram ${method}: ${body.description || res.status}`);
  return body.result;
}

export function sendMessage(token, chatId, text, keyboard, html = true) {
  return call(token, 'sendMessage', {
    chat_id: chatId,
    text,
    ...(html ? { parse_mode: 'HTML' } : {}),
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  });
}

export const answerCallback = (token, id) => call(token, 'answerCallbackQuery', { callback_query_id: id }).catch(() => {});

// file: { name, content (Buffer) }
export async function sendDocument(token, chatId, file, caption) {
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('document', new Blob([file.content], { type: 'application/pdf' }), file.name);
  // Telegram captions stop at 1024 characters; longer text goes in its own message
  if (caption && caption.length <= 1024) {
    form.append('caption', caption);
    form.append('parse_mode', 'HTML');
  }
  const res = await fetch(api(token, 'sendDocument'), { method: 'POST', body: form });
  const body = await res.json().catch(() => ({}));
  if (!body.ok) throw new Error(`Telegram sendDocument: ${body.description || res.status}`);
  if (caption && caption.length > 1024) await sendMessage(token, chatId, caption);
  return body.result;
}

export const setWebhook = (token, url, secret) =>
  call(token, 'setWebhook', { url, secret_token: secret, allowed_updates: ['message', 'callback_query'] });
