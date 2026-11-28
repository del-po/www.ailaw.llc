import { CheckoutRules } from './checkout-fields';
import { Order } from './order';

// Rows as the admin sees them: every status, raw prices and discount dates

export type ServiceStatus = 'Active' | 'Draft' | 'Inactive';

export interface AdminServiceRow {
  ID: number;
  Slug: string;
  Name: string;
  ShortDescription: string;
  Description: string;
  Category: string;
  Image: string; // Storage path (services/…), or an image URL
  Status: ServiceStatus;
  Currency: string;
  Price: number;
  DiscountedPrice: number | '';
  DiscountStart: string; // yyyy-mm-dd or ''
  DiscountEnd: string;
  // once: paid when ordered; ongoing: fee per UnitLabel until cancelled
  Billing: 'once' | 'ongoing';
  UnitLabel: string;
  // What checkout asks for when this service is in the cart
  CheckoutFields: CheckoutRules;
}

// What the editor sends; the backend fills in the ID and checks everything
export type AdminServiceInput = Omit<AdminServiceRow, 'ID'>;

export interface AdminCategory {
  ID: number;
  Name: string;
  Status: 'Active' | 'Inactive';
}

// ---------- Orders ----------

// A picture or file sent to the backend
export interface Upload {
  name: string;
  type: string;
  data: string; // base64
}

// An order typed in by the admin (phone, Telegram…): for an existing client
// (clientId) or a new guest
export interface AdminNewOrder {
  clientId?: string;
  guest?: { firstName: string; lastName: string; email: string; phone: string };
  items: { slug: string; quantity: number }[];
  payment: 'invoice' | 'paid';
  customerNotes: string;
}

// ---------- Blog ----------

export type PostStatus = 'draft' | 'scheduled' | 'published';

export interface AdminPostRow {
  slug: string;
  title: string;
  category: string;
  featured: boolean;
  status: PostStatus;
  publishedAt: string; // ISO or ''
  updatedAt: string;
}

export interface AdminPost {
  slug: string;
  title: string;
  deck: string;
  body: string; // Markdown
  author: string;
  category: string;
  tags: string; // comma-separated
  featured: boolean;
  status: PostStatus;
  cover: string; // picture link or ''
  publishedAt: string;
  updatedAt: string;
}

// ---------- Dashboard (admin:dashboard) ----------

// Amounts per currency, e.g. { GEL: 120 }
export type Amounts = Record<string, number>;

export interface AuditChange {
  from: unknown;
  to: unknown;
}

// One line of the audit log: an admin change, from the panel or the chat
export interface AuditEntry {
  id: string;
  time: string;
  who: string;
  email: string;
  via: 'panel' | 'chat';
  action: string;
  target: { kind: string; id: string } | null;
  changes: Record<string, AuditChange> | null;
  data: Record<string, unknown> | null;
  ok: boolean;
  error: string;
}

export interface ErrorEntry {
  id: string;
  time: string;
  action: string;
  error: string;
  details: string;
}

export interface StuckStep {
  orderNumber: string;
  service: string;
  step: string;
  owner: 'chat' | 'lawyer';
  since: string;
  // failed, past its deadline, or still for too long
  reason: 'failed' | 'late' | 'still';
}

export interface SeriesPoint {
  key: string;
  orders: number;
  revenue: number;
}

export interface Dashboard {
  period: { from: string; to: string };
  clients: {
    total: number;
    user: number;
    verified: number;
    guest: number;
    suspended: number;
    new: number;
  };
  orders: {
    total: number;
    new: number;
    byStatus: Record<'placed' | 'in_progress' | 'completed' | 'cancelled', number>;
  };
  revenue: Amounts;
  outstanding: { count: number; amounts: Amounts };
  services: { active: number; total: number };
  lawyers: { active: number; applications: number };
  tasksWaiting: number;
  // Lawyers' results waiting for approval
  toApprove: number;
  stuck: { days: number; count: number; list: StuckStep[] };
  errors: { count: number; latest: { time: string; action: string; error: string }[] };
  chat: { questions: number };
  // Not tracked yet
  aiSpending: Amounts | null;
  traffic: number | null;
  recent: AuditEntry[];
  series: { unit: 'day' | 'month'; currency: string; points: SeriesPoint[] };
}

// A period by Tbilisi days, "yyyy-MM-dd"
export interface Period {
  from: string;
  to: string;
}

// ---------- Order workspace (order:get) ----------

export type StepStatus = 'waiting' | 'active' | 'review' | 'failed' | 'done' | 'skipped';

export interface StepConfig {
  needsFile?: boolean;
  needsApproval?: boolean;
  dueDays?: number;
  email?: boolean;
  [key: string]: unknown;
}

// One step of an order's workflow; result "file:<path>" is a stored file
export interface OrderStep {
  stepNo: number;
  owner: 'chat' | 'lawyer';
  capability: string;
  clientLabel: string;
  lawyerTask: string;
  config: StepConfig;
  status: StepStatus;
  result: string;
  note: string;
  error: string;
  dueAt: string;
  updatedAt: string;
  late: boolean;
}

export type StepOp = 'complete' | 'correct' | 'approve' | 'sendBack' | 'restart' | 'skip' | 'edit';

export interface StoredFile {
  name: string;
  path: string;
  size: number;
  contentType: string;
  updatedAt: string;
}

// A folder with what is inside it, two levels down
export interface FileNode {
  name: string;
  path: string;
  files: StoredFile[];
  folders: FileNode[];
}

export interface WorkspaceAssignment {
  assignmentId: string;
  lawyerId: string;
  lawyerName: string;
  role: 'lead' | 'reviewer';
  status: string;
  tasks: string[];
  fee: number;
  assignedAt: string;
  completedAt: string;
}

export interface OrderWorkspace {
  order: Order & {
    service: string;
    details: Record<string, string | number>;
    source: string;
    conversationId: string;
    dueAt: string;
    adminNotes: string;
    folder: string;
    agreement: string;
    emailedAt: string;
  };
  client: {
    clientId: string;
    name: string;
    email: string;
    phone: string;
    type: string;
    status: string;
    notes: string;
  } | null;
  steps: OrderStep[];
  canStartWorkflow: boolean;
  assignments: WorkspaceAssignment[];
  files: FileNode | null;
  history: Pick<
    AuditEntry,
    'id' | 'time' | 'who' | 'via' | 'action' | 'changes' | 'ok' | 'error'
  >[];
}

// What can be changed on an order (order:edit); dueAt "yyyy-MM-dd" or '' to clear
export interface OrderChanges {
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  customerNotes?: string;
  billingAddress?: string;
  adminNotes?: string;
  details?: Record<string, string | number>;
  dueAt?: string;
}

export interface StepChange {
  result?: string;
  note?: string;
  file?: Upload;
  replace?: boolean;
  clientLabel?: string;
  lawyerTask?: string;
  dueAt?: string;
}

// ---------- Documents (files:…) ----------

export interface StorageFolder {
  path: string;
  crumbs: { name: string; path: string }[];
  folders: { name: string; path: string }[];
  files: StoredFile[];
}

// ---------- Service workflows (workflow:get / workflow:set) ----------

export interface WorkflowStep {
  stepNo?: number;
  owner: 'chat' | 'lawyer';
  capability: string;
  clientLabel: string;
  lawyerTask: string;
  config: StepConfig;
}

export interface ServiceWorkflow {
  slug: string;
  name: string;
  plugin: string;
  workflow: WorkflowStep[];
  pluginSteps: WorkflowStep[];
  capabilities: string[];
}

// ---------- AI Management (ai:…) ----------

export type Side = 'client' | 'lawyer' | 'admin';

export interface Instruction {
  title: string;
  text: string;
  order: number;
  active: boolean;
}

// One piece of a plugin's know-how; audience: the assistants that read it
export interface KnowledgeItem {
  title: string;
  text: string;
  audience: Side[];
  active: boolean;
}

export interface AiPlugin {
  id: string;
  enabled: boolean;
  sides: Side[];
  kind: string;
  menu: string;
  version: string;
  items: KnowledgeItem[];
  steps: number;
}

// Model settings; '' = not set (an assistant then uses the shared value)
export type ModelSettings = Record<string, string | number>;

export interface AiOverview {
  shared: ModelSettings;
  assistants: { side: Side; ai: ModelSettings; instructions: Instruction[] }[];
  plugins: AiPlugin[];
  // USD per million tokens
  prices: Record<string, { input: number; output: number }>;
}

export interface AiVersion {
  id: string;
  savedAt: string;
  by: string;
  count: number;
  value: (Instruction | KnowledgeItem)[];
}

export interface AiTestResult {
  answer: string;
  promptCharacters: number;
  model: string;
  provider: string;
  seconds: number;
}

export interface AiUsageLine {
  date: string;
  side: string;
  provider: string;
  model: string;
  requests: number;
  failures: number;
  promptTokens: number;
  completionTokens: number;
  cost: number | null;
}

export interface AiUsage {
  period: Period;
  totals: {
    requests: number;
    failures: number;
    promptTokens: number;
    completionTokens: number;
    cost: number;
    unpriced: string[];
  };
  lines: AiUsageLine[];
}

export interface AiMistake {
  id: string;
  conversationId: string;
  messageId: string;
  side: string;
  question: string;
  answer: string;
  note: string;
  status: 'open' | 'resolved';
  resolution: string;
  by: string;
  createdAt: string;
  resolvedAt: string;
}

// ---------- Communications (comms:…) ----------

export interface ConversationRow {
  id: string;
  side: Side;
  title: string;
  email: string;
  guest: boolean;
  scope: string;
  activeService: string;
  updatedAt: string;
  createdAt: string;
  needsHuman: boolean;
  needsHumanReason: string;
  answeredByTeamAt: string;
}

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  parts: string[];
  team: boolean;
  deleted: boolean;
  mistakeId: string;
  createdAt: string;
}

export interface ConversationDetail extends ConversationRow {
  owner: { clientId: string; name: string; email: string; type: string } | null;
  messages: ConversationMessage[];
  emailed?: string;
}

// ---------- System Settings (system:…) ----------

export interface CompanyDetails {
  name: string;
  registration: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  signatory: string;
  verifyContact: string;
  applicationsEmail: string;
}

export interface SystemSettings {
  company: CompanyDetails;
  defaults: CompanyDetails;
  bank: { BankRecipient: string; BankName: string; BankIban: string };
  notifications: { lawyerTasksEmail: string; applicationsEmail: string; sendsFrom: string };
  platform: { orderingOpen: boolean; orderingPausedText: string };
  integrations: { name: string; connected: boolean }[];
  access: {
    admins: { clientId: string; name: string; email: string; status: string }[];
    lawyers: { lawyerId: string; name: string; email: string; status: string }[];
  };
}

export interface SystemChanges {
  company?: Partial<CompanyDetails>;
  bank?: Partial<SystemSettings['bank']>;
  notifications?: { lawyerTasksEmail?: string };
  platform?: Partial<SystemSettings['platform']>;
}

// ---------- Content (content:…) ----------

// One edited block of the website's text; value types follow content-blocks.ts
export interface ContentRecord {
  key: string;
  type: string;
  markdown: string[];
  draft: unknown;
  published: unknown;
  // A draft that differs from what the site shows
  changed: boolean;
  draftAt: string;
  draftBy: string;
  publishedAt: string;
  publishedBy: string;
}

export interface ContentVersion {
  id: string;
  savedAt: string;
  publishedAt: string;
  by: string;
  value: unknown;
}
