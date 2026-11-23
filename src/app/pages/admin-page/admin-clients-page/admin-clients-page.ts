import { Component, afterNextRender, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { AdminService } from '../../../core/services/admin.service';
import { AuthService } from '../../../core/services/auth.service';
import { Profile } from '../../../core/models/profile';
import { Shape } from '../../../shared/kit/shapes/shape';
import { adminErrorMessage } from '../admin-links';

const PROVIDER_NAMES: Record<string, string> = {
  password: 'Email',
  'google.com': 'Google',
};

@Component({
  selector: 'app-admin-clients-page',
  imports: [DatePipe, Shape],
  templateUrl: './admin-clients-page.html',
  styleUrl: './admin-clients-page.scss',
})
export class AdminClientsPage {
  private readonly admin = inject(AdminService);
  private readonly auth = inject(AuthService);

  protected readonly clients = signal<Profile[] | null>(null);
  protected readonly search = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly busyId = signal<string | null>(null);

  // Newest first, filtered by name, email or phone
  protected readonly list = computed(() => {
    const words = this.search().toLowerCase().split(/\s+/).filter(Boolean);
    return (this.clients() ?? [])
      .filter((c) => {
        const text = [c.DisplayName, c.FirstName, c.LastName, c.Email, c.Phone]
          .join(' ')
          .toLowerCase();
        return words.every((w) => text.includes(w));
      })
      .sort((a, b) => String(b.CreatedAt).localeCompare(String(a.CreatedAt)));
  });

  protected readonly total = computed(() => this.clients()?.length ?? 0);
  protected readonly suspended = computed(
    () => this.clients()?.filter((c) => c.Status === 'suspended').length ?? 0,
  );

  constructor() {
    afterNextRender(() => this.load());
  }

  protected async load(): Promise<void> {
    this.error.set(null);
    try {
      this.clients.set(await this.admin.listClients());
    } catch (error) {
      this.error.set(adminErrorMessage(error));
    }
  }

  protected providers(client: Profile): string {
    return client.Providers.split(',')
      .filter(Boolean)
      .map((id) => PROVIDER_NAMES[id] ?? id)
      .join(', ');
  }

  // Only clients can be suspended here, and never your own account
  protected canChange(client: Profile): boolean {
    return client.Role === 'client' && client.UserID !== this.auth.user()?.uid;
  }

  protected async toggle(client: Profile): Promise<void> {
    const status = client.Status === 'active' ? 'suspended' : 'active';
    const name = client.DisplayName || client.Email;
    if (
      status === 'suspended' &&
      !confirm(`Suspend ${name}? They won't be able to use their account.`)
    )
      return;

    this.busyId.set(client.UserID);
    this.error.set(null);
    try {
      const updated = await this.admin.setClientStatus(client.UserID, status);
      this.clients.update(
        (list) => list?.map((c) => (c.UserID === updated.UserID ? updated : c)) ?? null,
      );
    } catch (error) {
      this.error.set(adminErrorMessage(error));
    } finally {
      this.busyId.set(null);
    }
  }
}
