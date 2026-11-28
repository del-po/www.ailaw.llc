import { AuditEntry } from '../../core/models/admin';

// Plain names for the admin actions the audit log records; anything not
// listed shows its own action name
const ACTIONS: Record<string, string> = {
  setUserStatus: 'Account status changed',
  'admin:verifyClient': 'Client verified',
  'admin:unverifyClient': 'Verification removed',
  'admin:linkAccount': 'Account linked to client',
  'admin:setClientNotes': 'Internal notes changed',
  'admin:createOrder': 'Order created',
  adminUpdateOrder: 'Order status changed',
  'admin:remakeAgreement': 'Agreement made again',
  'admin:resendEmail': 'Order email sent again',
  'admin:assign': 'Lawyer assigned',
  'admin:completeStep': 'Step completed',
  'admin:approveLawyer': 'Lawyer approved',
  'admin:rejectLawyer': 'Lawyer application declined',
  'services:create': 'Service created',
  'services:update': 'Service changed',
  'services:delete': 'Service archived',
  'services:image': 'Service image changed',
  'categories:create': 'Category created',
  'categories:update': 'Category changed',
  'categories:delete': 'Category deleted',
  'blog:save': 'Article saved',
  'blog:cover': 'Article cover changed',
  'blog:delete': 'Article deleted',
  'declarations:add': '1%: client added',
  'declarations:delete': '1%: client deleted',
  'declarations:setMonth': '1%: month figures changed',
  'declarations:setDebt': '1%: debt changed',
  'declarations:setContacts': '1%: contacts changed',
  'declarations:setStatus': '1%: service status changed',
  'declarations:verify': '1%: client verified',
  'declarations:deliver': '1%: declaration delivered',
  'declarations:settings': '1%: settings changed',
};

export const actionLabel = (action: string): string => ACTIONS[action] ?? action;

// "client ID-7K3Q9X", "order AIL-…", or '' when the action had no one record
export const targetLabel = (entry: AuditEntry): string =>
  entry.target ? `${entry.target.kind} ${entry.target.id}` : '';

// A value as it is shown in a before → after line
export function shown(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string') return value.length > 80 ? value.slice(0, 80) + '…' : value;
  const text = JSON.stringify(value);
  return text.length > 80 ? text.slice(0, 80) + '…' : text;
}
