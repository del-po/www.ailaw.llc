import { Service, inject } from '@angular/core';
import {
  AdminCategory,
  AdminNewOrder,
  AdminPost,
  AdminPostRow,
  AdminServiceInput,
  AdminServiceRow,
  AuditEntry,
  Dashboard,
  ErrorEntry,
  OrderChanges,
  OrderWorkspace,
  Period,
  ServiceWorkflow,
  StepChange,
  StepOp,
  StorageFolder,
  StoredFile,
  Upload,
  WorkflowStep,
} from '../models/admin';
import {
  DeclarationClient,
  DeclarationMonth,
  DeclarationSettings,
  DeclarationsList,
  DeliveryResult,
  NewDeclarationClient,
} from '../models/declarations';
import { AdminLawyer } from '../models/lawyer';
import { LawyerTask } from '../models/chat';
import { Order } from '../models/order';
import { Profile } from '../models/profile';
import { AuthService } from './auth.service';
import { DOORS, DoorResult } from './doors';

@Service()
export class AdminService {
  private readonly auth = inject(AuthService);

  // ---------- Services ----------

  listServices(): Promise<AdminServiceRow[]> {
    return this.call('services:list');
  }

  createService(data: AdminServiceInput): Promise<AdminServiceRow> {
    return this.call('services:create', { data });
  }

  updateService(id: number, data: Partial<AdminServiceInput>): Promise<AdminServiceRow> {
    return this.call('services:update', { id, data });
  }

  // Sets the status to Inactive; the row stays for past orders
  archiveService(id: number): Promise<unknown> {
    return this.call('services:delete', { id });
  }

  uploadServiceImage(id: number, file: Upload): Promise<AdminServiceRow> {
    return this.call('services:image', { id, file });
  }

  // The steps every new order of a service runs
  getWorkflow(slug: string): Promise<ServiceWorkflow> {
    return this.call('workflow:get', { slug });
  }

  setWorkflow(slug: string, steps: WorkflowStep[]): Promise<ServiceWorkflow> {
    return this.call('workflow:set', { slug, steps });
  }

  // ---------- Categories ----------

  listCategories(): Promise<AdminCategory[]> {
    return this.call('categories:list');
  }

  createCategory(name: string): Promise<AdminCategory> {
    return this.call('categories:create', { data: { Name: name } });
  }

  updateCategory(
    id: number,
    data: Partial<Pick<AdminCategory, 'Name' | 'Status'>>,
  ): Promise<AdminCategory> {
    return this.call('categories:update', { id, data });
  }

  // ---------- Clients ----------

  listClients(): Promise<Profile[]> {
    return this.call('listUsers');
  }

  setClientStatus(userId: string, status: 'active' | 'suspended' | 'deleted'): Promise<Profile> {
    return this.call('setUserStatus', { userId, status });
  }

  // ---------- Lawyers ----------

  listLawyers(): Promise<AdminLawyer[]> {
    return this.call('admin:lawyers');
  }

  // Creates their login and emails them a link to set a password
  approveLawyer(lawyerId: string): Promise<AdminLawyer[]> {
    return this.call('admin:approveLawyer', { lawyerId });
  }

  rejectLawyer(lawyerId: string): Promise<AdminLawyer[]> {
    return this.call('admin:rejectLawyer', { lawyerId });
  }

  // ---------- All clients (users, verified, guests) ----------

  allClients(): Promise<Profile[]> {
    return this.call('admin:clients');
  }

  verifyClient(
    clientId: string,
    details: { passport: string; idNumber: string; address: string; phone: string },
  ): Promise<Profile> {
    return this.call('admin:verifyClient', { clientId, ...details });
  }

  unverifyClient(clientId: string): Promise<Profile> {
    return this.call('admin:unverifyClient', { clientId });
  }

  // AI Law's internal notes on a client, never shown to the client
  setClientNotes(clientId: string, notes: string): Promise<Profile> {
    return this.call('admin:setClientNotes', { clientId, notes });
  }

  // Joins a website login (userId) to an existing client without one; the
  // record the sign-up made is merged into it
  linkAccount(clientId: string, userId: string): Promise<Profile> {
    return this.call('admin:linkAccount', { clientId, userId });
  }

  // ---------- Dashboard, audit log, errors ----------

  dashboard(period: Period): Promise<Dashboard> {
    return this.call('admin:dashboard', period);
  }

  // Admin changes, newest first; via: only the panel's or the chat's
  auditLog(
    filters: Period & { query?: string; via?: 'panel' | 'chat'; failed?: boolean; limit?: number },
  ): Promise<AuditEntry[]> {
    return this.call('admin:audit', filters);
  }

  errorLog(filters: Period & { query?: string; limit?: number }): Promise<ErrorEntry[]> {
    return this.call('admin:logs', filters);
  }

  // ---------- Review ----------

  // Order steps waiting for AI Law
  reviewTasks(): Promise<LawyerTask[]> {
    return this.call('admin:tasks');
  }

  // ---------- Orders ----------

  createOrder(order: AdminNewOrder): Promise<Order> {
    return this.call('admin:createOrder', order);
  }

  remakeAgreement(orderId: string): Promise<Order> {
    return this.call('admin:remakeAgreement', { orderId });
  }

  resendEmail(orderId: string): Promise<Order> {
    return this.call('admin:resendEmail', { orderId });
  }

  assignLawyer(orderNumber: string, lawyerId: string, role: 'lead' | 'reviewer'): Promise<unknown> {
    return this.call('admin:assign', { orderNumber, lawyerId, role });
  }

  // ---------- One order's workspace ----------

  orderWorkspace(orderNumber: string): Promise<OrderWorkspace> {
    return this.call('order:get', { orderNumber });
  }

  editOrder(orderNumber: string, changes: OrderChanges): Promise<OrderWorkspace> {
    return this.call('order:edit', { orderNumber, ...changes });
  }

  // Unpaid orders only; the totals follow
  setOrderPrices(
    orderNumber: string,
    items: { orderItemId: string; unitPrice: number; discountAmount: number }[],
  ): Promise<OrderWorkspace> {
    return this.call('order:prices', { orderNumber, items });
  }

  stepAction(
    orderNumber: string,
    stepNo: number,
    op: StepOp,
    change: StepChange = {},
  ): Promise<OrderWorkspace> {
    return this.call('order:step', { orderNumber, stepNo, op, ...change });
  }

  startWorkflow(orderNumber: string): Promise<OrderWorkspace> {
    return this.call('order:startWorkflow', { orderNumber });
  }

  unassignLawyer(orderNumber: string, assignmentId: string): Promise<OrderWorkspace> {
    return this.call('order:unassign', { orderNumber, assignmentId });
  }

  // ---------- Documents (all of Storage) ----------

  listFiles(path: string): Promise<StorageFolder> {
    return this.call('files:list', { path });
  }

  searchFiles(query: string, period: Partial<Period> = {}): Promise<StoredFile[]> {
    return this.call('files:search', { query, ...period });
  }

  getFile(path: string): Promise<{ name: string; mimeType: string; data: string }> {
    return this.call('files:get', { path });
  }

  fileVersions(path: string): Promise<StoredFile[]> {
    return this.call('files:versions', { path });
  }

  // replace: an existing file of the same name is kept in "Versions" first
  uploadFile(
    folder: string,
    file: Upload,
    replace = false,
  ): Promise<{ path: string; replaced: boolean }> {
    return this.call('files:upload', { folder, file, replace });
  }

  renameFile(path: string, name: string): Promise<{ path: string }> {
    return this.call('files:rename', { path, name });
  }

  moveFile(path: string, folder: string): Promise<{ path: string }> {
    return this.call('files:move', { path, folder });
  }

  newFolder(folder: string, name: string): Promise<{ path: string }> {
    return this.call('files:newFolder', { folder, name });
  }

  // Moves it to the trash folder
  deleteFile(path: string): Promise<unknown> {
    return this.call('files:delete', { path });
  }

  // ---------- Blog ----------

  listPosts(): Promise<AdminPostRow[]> {
    return this.call('blog:list');
  }

  getPost(slug: string): Promise<AdminPost> {
    return this.call('blog:get', { slug });
  }

  savePost(post: Partial<AdminPost> & { tags: string }): Promise<{ slug: string }> {
    return this.call('blog:save', post);
  }

  uploadCover(slug: string, file: Upload): Promise<AdminPost> {
    return this.call('blog:cover', { slug, file });
  }

  deletePost(slug: string): Promise<unknown> {
    return this.call('blog:delete', { slug });
  }

  // ---------- 1% declarations ----------
  // A client is named by key: their registration ID, or ID-… code

  // What waits for the reporting month: for the sidebar
  declarationCounts(): Promise<{
    reportingMonth: string;
    notReported: number;
    toFile: number;
    toVerify: number;
  }> {
    return this.call('declarations:counts');
  }

  listDeclarations(year: string): Promise<DeclarationsList> {
    return this.call('declarations:list', { year });
  }

  // income and/or tax for one month; null clears a figure
  setDeclarationMonth(
    key: string,
    month: string,
    figures: { income?: number | null; tax?: number | null },
  ): Promise<DeclarationMonth> {
    return this.call('declarations:setMonth', { key, month, ...figures });
  }

  setDeclarationDebt(key: string, amount: number): Promise<unknown> {
    return this.call('declarations:setDebt', { key, amount });
  }

  setDeclarationContacts(
    key: string,
    contacts: {
      registrationId: string;
      telegramId: string;
      email: string;
      deliveryMethod: 'telegram' | 'email';
    },
  ): Promise<DeclarationClient> {
    return this.call('declarations:setContacts', { key, ...contacts });
  }

  // ended: the client cancelled the service
  setDeclarationStatus(key: string, status: 'active' | 'ended'): Promise<DeclarationClient> {
    return this.call('declarations:setStatus', { key, status });
  }

  addDeclarationClient(client: NewDeclarationClient): Promise<DeclarationClient> {
    return this.call('declarations:add', client);
  }

  // Off the list with every month; files: also their declarations folder
  deleteDeclarationClient(key: string, files: boolean): Promise<unknown> {
    return this.call('declarations:delete', { key, files });
  }

  // A self-registered (pending) client gets a client record and folder
  verifyDeclarationClient(key: string): Promise<DeclarationClient> {
    return this.call('declarations:verify', { key });
  }

  // With a file: saved in the client's folder, then sent. Without: the
  // month's file already there is sent again
  deliverDeclaration(key: string, month: string, file?: Upload): Promise<DeliveryResult> {
    return this.call('declarations:deliver', { key, month, file: file ?? null });
  }

  // Called with nothing, it only reads the settings
  declarationSettings(changes: Partial<DeclarationSettings> = {}): Promise<DeclarationSettings> {
    return this.call('declarations:settings', changes);
  }

  // ---------- Helpers ----------

  // Every admin action goes through the admin door
  private async call<T>(action: string, data: object = {}): Promise<T> {
    const res = await fetch(DOORS.admin, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, idToken: await this.auth.idToken(), data }),
    });
    const result = (await res.json()) as DoorResult<T>;
    if (!result.ok) throw new Error(result.error);
    return result.data;
  }
}
