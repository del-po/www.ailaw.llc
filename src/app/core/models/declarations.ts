// 1% small business declarations, as the admin door returns them
// (functions/plugins/small-business-declarations)

export interface DeclarationMonth {
  month: string; // 2026-10
  income: number | null;
  tax: number | null; // typed in from rs.ge when filing
  serviceFee: number | null;
  source: string; // telegram, chat, website, manual, sheet-import
  reportedAt: string;
  declarationFile: string;
  deliveredAt: string;
  deliveredVia: string;
}

export interface DeclarationClient {
  key: string; // the registration ID, or the ID-… code when there is none
  registrationId: string;
  name: string;
  clientId: string;
  status: 'active' | 'pending' | 'ended';
  telegramId: string;
  telegramUsername: string;
  email: string;
  serviceStart: string;
  endedAt: string;
  // Another record has the same registration ID: to sort out by hand
  duplicateOf: string;
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

// ---------- The client's side ----------

// One payment received, as the client enters it
export interface IncomeEntry {
  date: string; // 2026-10-12
  currency: string; // GEL, USD, EUR, GBP
  amount: number;
}

export interface MyDeclarationMonth {
  month: string;
  income: number | null;
  tax: number | null;
  reportedAt: string;
  deliveredAt: string;
  fileId: string; // inside the client's documents ('' = no file)
}

export interface MyDeclarations {
  reportingMonth: string;
  name: string;
  registrationId: string;
  outstandingDebt: number;
  feePerDeclaration: number;
  months: MyDeclarationMonth[];
}

export interface IncomeSaved {
  month: string;
  income: number;
}
