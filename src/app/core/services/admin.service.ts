import { Service, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom, map } from 'rxjs';
import { AdminCategory, AdminServiceInput, AdminServiceRow } from '../models/admin';
import { Profile } from '../models/profile';
import { AuthService } from './auth.service';

// Same web apps the public pages read from; writing needs an admin login
const SERVICES_API =
  'https://script.google.com/macros/s/AKfycbyNs3jIEwcxkMs6B5311wqt3gkbDseNf2zOQgpKu0vmskRE9mLTK0jqvDq8wPBl4XyS/exec';
const PROFILES_API =
  'https://script.google.com/macros/s/AKfycbx_Vvn6RD5TcfudfTzLA8AuqD3i7xo5l0VPos1nOOZ-1yl3TdQy9mqQ2qpBpXk-7cTVtQ/exec';

// Plain text skips the browser's CORS pre-check, which Apps Script can't answer
const HEADERS = new HttpHeaders({ 'Content-Type': 'text/plain;charset=utf-8' });

// The two scripts answer in slightly different shapes
type ServicesResult<T> = { success: true; data: T } | { success: false; error: string };
type ProfilesResult<T> = { ok: true; data: T } | { ok: false; error: string };

@Service()
export class AdminService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  // ---------- Services ----------

  listServices(): Promise<AdminServiceRow[]> {
    return this.services('services', 'list');
  }

  createService(data: AdminServiceInput): Promise<AdminServiceRow> {
    return this.services('services', 'create', { data });
  }

  updateService(id: number, data: Partial<AdminServiceInput>): Promise<AdminServiceRow> {
    return this.services('services', 'update', { id, data });
  }

  // Sets the status to Inactive; the row stays for past orders
  archiveService(id: number): Promise<unknown> {
    return this.services('services', 'delete', { id });
  }

  // ---------- Categories ----------

  listCategories(): Promise<AdminCategory[]> {
    return this.services('categories', 'list');
  }

  createCategory(name: string): Promise<AdminCategory> {
    return this.services('categories', 'create', { data: { Name: name } });
  }

  updateCategory(
    id: number,
    data: Partial<Pick<AdminCategory, 'Name' | 'Status'>>,
  ): Promise<AdminCategory> {
    return this.services('categories', 'update', { id, data });
  }

  // ---------- Clients ----------

  listClients(): Promise<Profile[]> {
    return this.profiles('listUsers');
  }

  setClientStatus(userId: string, status: 'active' | 'suspended'): Promise<Profile> {
    return this.profiles('setUserStatus', { userId, status });
  }

  // ---------- Helpers ----------

  private async services<T>(action: string, operation: string, extra: object = {}): Promise<T> {
    const body = { idToken: await this.auth.idToken(), action, operation, ...extra };
    return firstValueFrom(
      this.http
        .post<ServicesResult<T>>(SERVICES_API, JSON.stringify(body), { headers: HEADERS })
        .pipe(
          map((result) => {
            if (!result.success) throw new Error(result.error);
            return result.data;
          }),
        ),
    );
  }

  private async profiles<T>(action: string, data: object = {}): Promise<T> {
    const body = { idToken: await this.auth.idToken(), action, data };
    return firstValueFrom(
      this.http
        .post<ProfilesResult<T>>(PROFILES_API, JSON.stringify(body), { headers: HEADERS })
        .pipe(
          map((result) => {
            if (!result.ok) throw new Error(result.error);
            return result.data;
          }),
        ),
    );
  }
}
