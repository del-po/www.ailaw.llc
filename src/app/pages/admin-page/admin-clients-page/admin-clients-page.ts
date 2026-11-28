import { Component, afterNextRender, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { AdminService } from '../../../core/services/admin.service';
import { AuthService } from '../../../core/services/auth.service';
import { ClientType, Profile } from '../../../core/models/profile';
import { Shape } from '../../../shared/kit/shapes/shape';
import { adminErrorMessage } from '../admin-links';

const PROVIDER_NAMES: Record<string, string> = {
  password: 'Email',
  'google.com': 'Google',
};

type Filter = 'all' | ClientType;

@Component({
  selector: 'app-admin-clients-page',
  imports: [DatePipe, Shape],
  templateUrl: './admin-clients-page.html',
  styleUrl: './admin-clients-page.scss',
})
export class AdminClientsPage {
  private readonly admin = inject(AdminService);
  private readonly auth = inject(AuthService);

  protected readonly filters: { value: Filter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'user', label: 'Accounts' },
    { value: 'verified', label: 'Verified' },
    { value: 'guest', label: 'Guests' },
  ];

  protected readonly clients = signal<Profile[] | null>(null);
  protected readonly filter = signal<Filter>('all');
  protected readonly search = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly busyId = signal<string | null>(null);
  // The client whose verification form is open
  protected readonly verifyingId = signal<string | null>(null);
  // The client (without a login) being joined to a website account
  protected readonly linkingId = signal<string | null>(null);
  // The client whose internal notes are open
  protected readonly notesId = signal<string | null>(null);

  // Website accounts that can be joined to a client: ordinary client logins
  protected readonly accounts = computed(() =>
    (this.clients() ?? [])
      .filter((c) => c.UserID && c.Role === 'client' && c.Type !== 'verified')
      .sort((a, b) => (a.DisplayName || a.Email).localeCompare(b.DisplayName || b.Email)),
  );

  // Newest first, filtered by type and by name, code, email or phone
  protected readonly list = computed(() => {
    const filter = this.filter();
    const words = this.search().toLowerCase().split(/\s+/).filter(Boolean);
    return (this.clients() ?? [])
      .filter((c) => filter === 'all' || c.Type === filter)
      .filter((c) => {
        const text = [c.ClientID, c.DisplayName, c.Email, c.Phone, c.Passport, c.IDNumber]
          .join(' ')
          .toLowerCase();
        return words.every((w) => text.includes(w));
      })
      .sort((a, b) => String(b.CreatedAt).localeCompare(String(a.CreatedAt)));
  });

  protected readonly total = computed(() => this.clients()?.length ?? 0);
  protected readonly verified = computed(
    () => this.clients()?.filter((c) => c.Type === 'verified').length ?? 0,
  );

  constructor() {
    afterNextRender(() => this.load());
  }

  protected async load(): Promise<void> {
    this.error.set(null);
    try {
      this.clients.set(await this.admin.allClients());
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

  // Only clients with an account can be suspended, and never your own account
  protected canSuspend(client: Profile): boolean {
    return !!client.UserID && client.Role === 'client' && client.UserID !== this.auth.user()?.uid;
  }

  protected async toggle(client: Profile): Promise<void> {
    const status = client.Status === 'active' ? 'suspended' : 'active';
    const name = client.DisplayName || client.Email;
    if (
      status === 'suspended' &&
      !confirm(`Suspend ${name}? They won't be able to use their account.`)
    )
      return;

    await this.run(client, () => this.admin.setClientStatus(client.UserID, status));
  }

  protected async verify(client: Profile, form: HTMLFormElement, event: Event): Promise<void> {
    event.preventDefault();
    const field = (name: string) =>
      (form.elements.namedItem(name) as HTMLInputElement).value.trim();
    const done = await this.run(client, () =>
      this.admin.verifyClient(client.ClientID, {
        passport: field('passport'),
        idNumber: field('idNumber'),
        address: field('address'),
        phone: field('phone'),
      }),
    );
    if (done) this.verifyingId.set(null);
  }

  protected async link(client: Profile, select: HTMLSelectElement): Promise<void> {
    const account = this.accounts().find((a) => a.UserID === select.value);
    if (!account) {
      this.error.set('Choose the website account first.');
      return;
    }
    if (
      !confirm(
        `Join ${account.DisplayName || account.Email} (${account.ClientID}, ${account.Email}) to ${client.DisplayName} (${client.ClientID})?\n\n` +
          `${client.ClientID} keeps its code and folder; ${account.ClientID}'s orders and files move to it and ${account.ClientID} is closed.`,
      )
    )
      return;
    this.busyId.set(client.ClientID);
    this.error.set(null);
    try {
      await this.admin.linkAccount(client.ClientID, account.UserID);
      this.linkingId.set(null);
      await this.load();
    } catch (error) {
      this.error.set(adminErrorMessage(error));
    } finally {
      this.busyId.set(null);
    }
  }

  // Internal notes are AI Law's own; the client never sees them
  protected async saveNotes(client: Profile, area: HTMLTextAreaElement): Promise<void> {
    const done = await this.run(client, () =>
      this.admin.setClientNotes(client.ClientID, area.value.trim()),
    );
    if (done) this.notesId.set(null);
  }

  protected async unverify(client: Profile): Promise<void> {
    if (!confirm(`Remove ${client.DisplayName || client.Email}'s verification?`)) return;
    await this.run(client, () => this.admin.unverifyClient(client.ClientID));
  }

  // Runs one change and puts the updated client in the list
  private async run(client: Profile, change: () => Promise<Profile>): Promise<boolean> {
    this.busyId.set(client.ClientID);
    this.error.set(null);
    try {
      const updated = await change();
      this.clients.update(
        (list) => list?.map((c) => (c.ClientID === updated.ClientID ? updated : c)) ?? null,
      );
      return true;
    } catch (error) {
      this.error.set(adminErrorMessage(error));
      return false;
    } finally {
      this.busyId.set(null);
    }
  }
}
