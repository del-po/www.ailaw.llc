import { Service, inject } from '@angular/core';
import {
  AdminCategory,
  AdminNewOrder,
  AdminPost,
  AdminPostRow,
  AdminServiceInput,
  AdminServiceRow,
  Upload,
} from '../models/admin';
import { AdminLawyer } from '../models/lawyer';
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
