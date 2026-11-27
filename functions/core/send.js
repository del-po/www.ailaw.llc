// ==========================================================
// Core: send (email)
// Two ways out, tried in this order:
//   1. SMTP: Gmail with an app password, sending as info@ailaw.llc
//      (secret SMTP_PASSWORD; "unset" switches it off). Attachments work.
//   2. The Apps Script relay (secret MAIL_SECRET): plain text, no
//      attachments. Used until SMTP is set up.
// Replacing Gmail with a mail service on the ailaw.llc domain later only
// changes this file.
// ==========================================================

import nodemailer from 'nodemailer';
import { COMPANY, ApiError } from './app.js';

const SMTP_USER = 'gochaokreshidze@gmail.com';
const MAIL_RELAY =
  'https://script.google.com/macros/s/AKfycbz6eb8HgMdSWWl_5eoEguD_muPHZDcvuJq02bWZI3OQyo4b_f9rXF9ck1-7hISr-yfO7g/exec';

let transport = null;

// mail = { to, subject, text, attachments?: [{ filename, content (Buffer), contentType }] }
// secrets = { smtpPassword, mailSecret }. Throws when nothing could send it.
export async function sendMail(mail, secrets) {
  if (!mail.to || !mail.subject) throw new ApiError('INVALID_MAIL');

  const password = String(secrets.smtpPassword || '').trim();
  if (password && password !== 'unset') {
    transport ||= nodemailer.createTransport({
      service: 'gmail',
      auth: { user: SMTP_USER, pass: password },
    });
    await transport.sendMail({
      from: `"AI Law" <${COMPANY.email}>`,
      replyTo: COMPANY.email,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      attachments: mail.attachments || [],
    });
    return 'smtp';
  }

  // Relay: no attachments, so the text says where to find them
  const note = mail.attachments?.length
    ? '\n\n(The documents are in your account: www.ailaw.llc/profile/documents)'
    : '';
  const res = await fetch(MAIL_RELAY, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      action: 'mail:send',
      secret: secrets.mailSecret,
      data: { to: mail.to, subject: mail.subject, body: mail.text + note },
    }),
  });
  let result = {};
  try {
    result = JSON.parse(await res.text());
  } catch {
    // An unreadable answer counts as a failure
  }
  if (!result.ok) throw new Error('Mail relay refused: ' + (result.error || res.status));
  return 'relay';
}
