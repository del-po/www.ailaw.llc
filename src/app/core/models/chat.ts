// A message is a list of parts, so the chat can show more than text:
// service cards, order progress and payment instructions.

export interface TextPart {
  type: 'text';
  text: string;
}

export interface FilePart {
  type: 'file';
  name: string;
  size: number;
}

export interface ServicePart {
  type: 'service';
  id: string;
  title: string;
  summary: string;
  price: string;
  link: string;
}

export type StepStatus = 'waiting' | 'in_progress' | 'done';

export interface OrderStep {
  label: string;
  status: StepStatus;
}

// Progress of a service order, as the client sees it
export interface OrderPart {
  type: 'order';
  orderId: string;
  title: string;
  status: 'in_progress' | 'completed';
  steps: OrderStep[];
}

// Bank transfer instructions for a new order
export interface PaymentPart {
  type: 'payment';
  amount: number;
  currency: string;
  reference: string;
}

// Income the chat read from a 1% declarations client's message: saved only
// when the client presses Confirm
export interface DeclarationPart {
  type: 'declaration';
  draftId: string;
  month: string;
  monthName: string;
  entries: { date: string; currency: string; amount: number; rate: number; gel: number }[];
  income: number;
  previousIncome: number | null;
}

export type MessagePart =
  TextPart | FilePart | ServicePart | OrderPart | PaymentPart | DeclarationPart;

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  parts: MessagePart[];
  createdAt: number;
  streaming?: boolean; // the answer is still being written out
  failed?: boolean; // shown in place of an answer that didn't arrive
}

export interface Conversation {
  id: string;
  title: string;
  updatedAt: number;
  messages: ChatMessage[];
  loaded: boolean; // messages fetched from the server
}

// ---------- Lawyer side (admin Review page) ----------

export interface LawyerTask {
  orderId: string;
  stepNo: number;
  label: string;
  task: string;
  needsFile: boolean;
  service: string;
  clientName: string;
  clientEmail: string;
  price: number;
  currency: string;
  details: Record<string, string | number>;
  createdAt: number;
  waitingSince: number;
}
