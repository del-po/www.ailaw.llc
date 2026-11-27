// ==========================================================
// Small business declarations: delivering a declaration
// The filed declaration (PDF) is saved in the client's own folder
//   clients/verified/ID-… - Name/SmallBusinessDeclarations/yyyy.MM.pdf
// linked to its month, and sent the way set for the client (deliveryMethod:
// telegram or email; unset = Telegram when they have a chat id, else email).
// A missing contact stops the delivery, never switches channel. Sending
// "test" (tool settings) sends to AI Law's own Telegram / email instead.
// ==========================================================

import { ApiError, COMPANY, db, now } from '../../core/app.js';
import { join, readFile, saveFile } from '../../core/files.js';
import { sendMail } from '../../core/send.js';
import { FOLDER, checkMonth, findClient, monthRef, requireActive, round2, settings } from './data.js';
import { sendDocument } from './telegram-api.js';

const MAX_BYTES = 20 * 1024 * 1024;
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const monthName = (month) => `${MONTH_NAMES[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;
export const fileName = (month) => month.replace('-', '.') + '.pdf';

const escape = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// The client's folder for this service ("" when they have no client record yet)
export async function clientFolder(client) {
  if (!client.clientId) return '';
  const record = (await db.doc('Clients/' + client.clientId).get()).data();
  return record?.folder ? join(record.folder, FOLDER) : '';
}

// ---------- The message ----------

// Same wording as the old Telegram sender
function caption(client, month, tax, cfg, html) {
  const b = (t) => (html ? `<b>${escape(t)}</b>` : t);
  const debt = round2(client.outstandingDebt);
  const lines = [
    `${b(`Hello, ${client.name.split(' ')[0]}!`)}`,
    '',
    `Here is your tax declaration for ${b(monthName(month))}.`,
    // The tax AI Law typed in from rs.ge; left out until it is there
    ...(typeof tax === 'number' ? [`The tax amount is: ${b(round2(tax).toFixed(2) + ' GEL')}.`] : []),
    `Outstanding Debt: ${b(debt.toFixed(2) + ' GEL')}`,
    '',
  ];
  if (debt > 0) {
    lines.push(
      `⚠️ Estimated daily penalty: ${b(round2(debt * 0.0005).toFixed(2) + ' GEL per day')}. ` +
        'This is calculated as 0.05% of the outstanding debt per overdue day.',
      '',
    );
  }
  lines.push(
    `Please don't forget to pay ${cfg.feePerDeclaration} GEL for our services to the following bank account: ` +
      (html ? `<code>${cfg.bankAccount}</code>` : cfg.bankAccount),
    '',
    b('Contact Us:'),
    `📧 Email: ${COMPANY.email}`,
    '📲 Telegram: t.me/ailawllc',
    '',
    b('Follow Us:'),
    `🌐 Website: https://${COMPANY.website}`,
    '🔗 LinkedIn: https://www.linkedin.com/in/ailaw/',
    '',
    b('Thank you!'),
    b(COMPANY.name),
  );
  return lines.join('\n');
}

// ---------- Sending ----------

// To the client (or, while testing, to AI Law). Returns how it went out.
// telegram or email, as set for the client
export const methodOf = (client) => client.deliveryMethod || (client.telegramId ? 'telegram' : 'email');

async function send(client, month, file, cfg, env) {
  const tax = (await monthRef(client.id, month).get()).data()?.tax;
  const testing = cfg.sending !== 'live';
  const label = testing ? `[TEST — for ${client.name}]\n` : '';
  const method = methodOf(client);

  if (method === 'telegram') {
    // The client's own contact must exist even while testing
    if (!client.telegramId) throw new ApiError('NO_TELEGRAM_ID');
    if (!env.telegramToken) throw new ApiError('NO_TELEGRAM_BOT');
    const chat = testing ? cfg.testTelegramId : client.telegramId;
    await sendDocument(env.telegramToken, chat, file, label + caption(client, month, tax, cfg, true));
    return testing ? 'telegram (test)' : 'telegram';
  }

  if (!client.email) throw new ApiError('NO_EMAIL');
  await sendMail(
    {
      to: testing ? cfg.testEmail : client.email,
      subject: `${label ? '[TEST] ' : ''}Your tax declaration for ${monthName(month)}`,
      text: label + caption(client, month, tax, cfg, false),
      attachments: [{ filename: file.name, content: file.content, contentType: 'application/pdf' }],
    },
    env.secrets,
  );
  return testing ? 'email (test)' : 'email';
}

// upload: { name, type, data (base64) } from the admin page; without it, the
// month's file already in the folder is sent again
// key: the client's key in the list (registration ID or ID-… code)
export async function deliver(key, month, upload, env) {
  checkMonth(month);
  const client = requireActive(await findClient({ key }));
  const folder = await clientFolder(client);
  if (!folder) throw new ApiError('NO_CLIENT_FOLDER');
  const cfg = await settings();
  const path = join(folder, fileName(month));

  let file;
  if (upload) {
    if (String(upload.type || '').toLowerCase() !== 'application/pdf') throw new ApiError('INVALID_FILE_TYPE');
    const content = Buffer.from(String(upload.data || ''), 'base64');
    if (!content.length) throw new ApiError('INVALID_FILE');
    if (content.length > MAX_BYTES) throw new ApiError('FILE_TOO_LARGE');
    await saveFile(path, content, 'application/pdf');
    file = { name: fileName(month), content };
  } else {
    const stored = await readFile(path);
    if (!stored) throw new ApiError('FILE_NOT_FOUND');
    file = { name: fileName(month), content: stored.content };
  }

  const ref = monthRef(client.id, month);
  await ref.set({ month, declarationFile: path, serviceFee: cfg.feePerDeclaration, filedAt: now() }, { merge: true });
  const via = await send(client, month, file, cfg, env);
  await ref.update({ deliveredAt: now(), deliveredVia: via });
  return { month, declarationFile: path, deliveredVia: via };
}
