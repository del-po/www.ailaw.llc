// 1% small business declarations, as the admin door returns them
// (functions/plugins/small-business-declarations)

export interface DeclarationMonth {
  month: string; // 2026-10
  income: number | null;
  tax: number | null;
  serviceFee: number | null;
  source: string; // telegram, chat, website, manual, sheet-import
  reportedAt: string;
  declarationFile: string;
  deliveredAt: string;
  deliveredVia: string;
}

export interface DeclarationClient {
  registrationId: string;
  name: string;
  clientId: string;
  status: 'active' | 'pending';
  telegramId: string;
  telegramUsername: string;
  email: string;
  serviceStart: string;
  outstandingDebt: number;
  months: DeclarationMonth[];
}

export interface DeclarationsList {
  year: string;
  reportingMonth: string;
  sending: 'test' | 'live';
  clients: DeclarationClient[];
}

export interface DeclarationSettings {
  sending: 'test' | 'live';
  feePerDeclaration: number;
  bankAccount: string;
  testTelegramId: string;
  testEmail: string;
  notifyEmail: string;
}

export interface DeliveryResult {
  month: string;
  declarationFile: string;
  deliveredVia: string;
}
