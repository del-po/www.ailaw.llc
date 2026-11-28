// ==========================================================
// Plugin: system desk (admin)
// The Admin Panel's System Settings:
//   system:get   company details (as agreements and emails show them), bank
//                details, notification emails, the platform switches,
//                which integrations are connected, and who has admin or
//                lawyer access
//   system:set   any of company, bank, notifications, platform
// Stored in Settings/company (over the defaults in core/app.js),
// Settings/chat (bank details and the lawyers' task email, which the
// chat and orders already read) and Settings/platform.
// Secrets (AI keys, mail, the Telegram bot) are only reported as connected
// or not: they are set with `firebase functions:secrets:set`, never here.
// Who is an admin is changed in Firestore (Clients/{id}.role), not here.
// ==========================================================

import { ApiError, COMPANY, COMPANY_DEFAULTS, cleanText, db, now, validEmail } from '../../core/app.js';
import { proposeAction } from '../../core/chat-actions.js';
import { docs, forget, platform, refreshCompany, setting } from '../../core/records.js';

const COMPANY_FIELDS = {
  name: 120,
  registration: 40,
  address: 300,
  phone: 40,
  email: 120,
  website: 120,
  signatory: 120,
  verifyContact: 300,
  applicationsEmail: 120,
};
const BANK_FIELDS = { BankRecipient: 120, BankName: 120, BankIban: 40 };

async function overview(env) {
  forget('setting:company');
  forget('setting:chat');
  forget('setting:platform');
  await refreshCompany();
  const [chat, switches, admins, staff] = await Promise.all([
    setting('chat'),
    platform(),
    db.collection('Clients').where('role', '==', 'admin').get(),
    db.collection('Staff').get(),
  ]);
  const values = chat.values || {};
  return {
    company: { ...COMPANY },
    defaults: { ...COMPANY_DEFAULTS },
    bank: Object.fromEntries(Object.keys(BANK_FIELDS).map((k) => [k, values[k] || ''])),
    notifications: {
      lawyerTasksEmail: values.LawyerEmail || '',
      applicationsEmail: COMPANY.applicationsEmail,
      sendsFrom: COMPANY.email,
    },
    platform: switches,
    integrations: [
      { name: 'Gemini (AI)', connected: !!env.keys?.gemini },
      { name: 'OpenAI (AI)', connected: !!env.keys?.openai },
      { name: 'Email sending (SMTP)', connected: !!env.secrets?.smtpPassword },
      { name: 'Mail relay (Apps Script)', connected: !!env.secrets?.mailSecret },
      { name: '1% declarations Telegram bot', connected: !!env.telegramToken },
    ],
    access: {
      admins: docs(admins).map((c) => ({ clientId: c.id, name: c.displayName || '', email: c.email || '', status: c.status })),
      lawyers: docs(staff)
        .filter((s) => ['approved', 'active', 'suspended'].includes(s.status))
        .map((s) => ({ lawyerId: s.id, name: `${s.firstName || ''} ${s.lastName || ''}`.trim(), email: s.email || '', status: s.status })),
    },
  };
}

function cleanGroup(input, fields) {
  const out = {};
  for (const [key, max] of Object.entries(fields)) {
    if (input?.[key] !== undefined) out[key] = cleanText(input[key], max, 'INVALID_SETTING');
  }
  return out;
}

async function save(data, env) {
  let changed = false;

  if (data.company) {
    const company = cleanGroup(data.company, COMPANY_FIELDS);
    for (const key of ['email', 'applicationsEmail']) {
      if (company[key] && !validEmail(company[key])) throw new ApiError('INVALID_EMAIL');
    }
    await db.doc('Settings/company').set({ values: company, updatedAt: now() }, { merge: true });
    changed = true;
  }

  // Bank details and the lawyers' task email live with the chat settings,
  // where orders and the step runner already read them
  const chat = {};
  if (data.bank) {
    const bank = cleanGroup(data.bank, BANK_FIELDS);
    if (bank.BankIban) bank.BankIban = bank.BankIban.replace(/\s+/g, '').toUpperCase();
    if (bank.BankIban && !/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(bank.BankIban)) throw new ApiError('INVALID_IBAN');
    Object.entries(bank).forEach(([k, v]) => (chat['values.' + k] = v));
  }
  if (data.notifications?.lawyerTasksEmail !== undefined) {
    const email = cleanText(data.notifications.lawyerTasksEmail, 120, 'INVALID_SETTING');
    if (email && !validEmail(email)) throw new ApiError('INVALID_EMAIL');
    chat['values.LawyerEmail'] = email;
  }
  if (Object.keys(chat).length) {
    await db.doc('Settings/chat').update(chat);
    changed = true;
  }

  if (data.platform) {
    const values = {};
    if (typeof data.platform.orderingOpen === 'boolean') values.orderingOpen = data.platform.orderingOpen;
    if (data.platform.orderingPausedText !== undefined) {
      values.orderingPausedText = cleanText(data.platform.orderingPausedText, 300, 'INVALID_SETTING');
    }
    await db.doc('Settings/platform').set({ values, updatedAt: now() }, { merge: true });
    changed = true;
  }

  if (!changed) throw new ApiError('NOTHING_TO_CHANGE');
  return overview(env);
}

// ---------- Admin chat tools ----------

const tools = {
  system_settings: {
    sides: ['admin'],
    description:
      'System settings: company details on agreements and emails, bank details, notification emails, whether new ' +
      'orders are open, which integrations are connected, and who has admin or lawyer access.',
    parameters: { type: 'object', properties: {} },
    run: async (ctx) => overview(ctx.env),
  },
  system_settings_set: {
    sides: ['admin'],
    description:
      'Proposes changing system settings. company: { name, registration, address, phone, email, website, signatory, ' +
      'verifyContact, applicationsEmail }; bank: { BankRecipient, BankName, BankIban }; notifications: ' +
      '{ lawyerTasksEmail }; platform: { orderingOpen (false pauses new orders), orderingPausedText }. Only what is ' +
      'given changes. Shows a Confirm card; nothing changes until the admin confirms.',
    parameters: {
      type: 'object',
      properties: {
        company: { type: 'object' },
        bank: { type: 'object' },
        notifications: { type: 'object' },
        platform: { type: 'object' },
      },
    },
    run: async (ctx, a) => {
      const lines = Object.entries(a || {}).flatMap(([group, values]) =>
        Object.entries(values || {}).map(([k, v]) => `${group}.${k}: ${String(v)}`),
      );
      if (!lines.length) return { error: 'NOTHING_TO_CHANGE' };
      return proposeAction(ctx, {
        action: 'system:set',
        data: a,
        title: 'Change system settings',
        lines,
        danger: a?.platform?.orderingOpen === false,
      });
    },
  },
};

export default {
  id: 'system-desk',
  sides: ['admin'],
  actions: {
    admin: {
      'system:get': (caller, data, env) => overview(env),
      'system:set': (caller, data, env) => save(data, env),
    },
  },
  tools,
};
