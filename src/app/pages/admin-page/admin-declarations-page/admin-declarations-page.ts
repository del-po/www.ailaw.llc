import { Component, afterNextRender, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { AdminService } from '../../../core/services/admin.service';
import {
  DeclarationClient,
  DeclarationMonth,
  DeclarationSettings,
  DeclarationsList,
} from '../../../core/models/declarations';
import { readUpload } from '../../../core/services/read-upload';
import { Shape } from '../../../shared/kit/shapes/shape';
import { adminErrorMessage } from '../admin-links';

// Where each client stands for the month clients report now
type Filter = 'all' | 'missing' | 'waiting' | 'delivered' | 'pending';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FIRST_YEAR = 2022;

// The year's figures for one client, laid out like the old sheet
interface SheetRow {
  client: DeclarationClient;
  income: (number | null)[];
  tax: (number | null)[];
  // per month: 'delivered' (declaration in the folder), 'reported', ''
  state: string[];
  incomeTotal: number;
  taxTotal: number;
}

const sum = (list: (number | null)[]) => list.reduce<number>((t, v) => t + (v ?? 0), 0);

@Component({
  selector: 'app-admin-declarations-page',
  imports: [DatePipe, DecimalPipe, Shape],
  templateUrl: './admin-declarations-page.html',
  styleUrl: './admin-declarations-page.scss',
})
export class AdminDeclarationsPage {
  private readonly admin = inject(AdminService);

  protected readonly monthLabels = MONTHS;
  protected readonly filters: { value: Filter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'missing', label: 'Not reported' },
    { value: 'waiting', label: 'To file' },
    { value: 'delivered', label: 'Delivered' },
    { value: 'pending', label: 'To verify' },
  ];

  protected readonly data = signal<DeclarationsList | null>(null);
  protected readonly year = signal(String(new Date().getFullYear()));
  protected readonly filter = signal<Filter>('all');
  protected readonly search = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly busy = signal(false);
  // The client whose panel is open, and the month being worked on there
  protected readonly openKey = signal<string | null>(null);
  protected readonly month = signal('');
  protected readonly settings = signal<DeclarationSettings | null>(null);
  protected readonly settingsOpen = signal(false);

  protected readonly years = computed(() => {
    const last = Math.max(
      new Date().getFullYear(),
      Number(this.data()?.reportingMonth.slice(0, 4) ?? 0),
    );
    return Array.from({ length: last - FIRST_YEAR + 1 }, (_, i) => String(last - i));
  });

  protected readonly reportingMonth = computed(() => this.data()?.reportingMonth ?? '');
  // The list only carries the year on screen, so the filters need that year
  // to be the one clients report in
  protected readonly showsReporting = computed(() => this.reportingMonth().startsWith(this.year()));

  protected readonly rows = computed<SheetRow[]>(() => {
    const filter = this.filter();
    const words = this.search().toLowerCase().split(/\s+/).filter(Boolean);
    return (this.data()?.clients ?? [])
      .filter((c) => filter === 'all' || !this.showsReporting() || this.stage(c) === filter)
      .filter((c) => {
        const text = [c.name, c.key, c.registrationId, c.clientId, c.telegramUsername, c.email]
          .join(' ')
          .toLowerCase();
        return words.every((w) => text.includes(w));
      })
      .map((client) => {
        const months = MONTHS.map((_, i) => this.monthOf(client, this.monthKey(i)));
        const income = months.map((m) => m?.income ?? null);
        const tax = months.map((m) => m?.tax ?? null);
        const state = months.map((m) =>
          m?.deliveredAt || m?.declarationFile ? 'delivered' : m?.income != null ? 'reported' : '',
        );
        return { client, income, tax, state, incomeTotal: sum(income), taxTotal: sum(tax) };
      });
  });

  // The bottom lines: every client on screen added up
  protected readonly totals = computed(() => {
    const rows = this.rows();
    const column = (pick: (r: SheetRow) => (number | null)[], i: number) =>
      rows.reduce((t, r) => t + (pick(r)[i] ?? 0), 0);
    return {
      income: MONTHS.map((_, i) => column((r) => r.income, i)),
      tax: MONTHS.map((_, i) => column((r) => r.tax, i)),
      incomeTotal: rows.reduce((t, r) => t + r.incomeTotal, 0),
      taxTotal: rows.reduce((t, r) => t + r.taxTotal, 0),
      debt: rows.reduce((t, r) => t + r.client.outstandingDebt, 0),
    };
  });

  // Counts for the reporting month, shown in the heading
  protected readonly counts = computed(() => {
    const all = this.data()?.clients ?? [];
    const count = (f: Filter) => all.filter((c) => this.stage(c) === f).length;
    return {
      total: all.length,
      missing: count('missing'),
      waiting: count('waiting'),
      pending: count('pending'),
    };
  });

  protected readonly openClient = computed(
    () => this.data()?.clients.find((c) => c.key === this.openKey()) ?? null,
  );

  protected readonly openMonth = computed(() => {
    const client = this.openClient();
    return client ? this.monthOf(client, this.month()) : null;
  });

  constructor() {
    afterNextRender(() => {
      this.load();
      this.loadSettings();
    });
  }

  protected async load(): Promise<void> {
    this.error.set(null);
    try {
      this.data.set(await this.admin.listDeclarations(this.year()));
    } catch (error) {
      this.error.set(adminErrorMessage(error));
    }
  }

  private async loadSettings(): Promise<void> {
    try {
      this.settings.set(await this.admin.declarationSettings());
    } catch {
      // The list still works; the settings strip just stays closed
    }
  }

  protected pickYear(year: string): void {
    this.year.set(year);
    this.filter.set('all');
    this.openKey.set(null);
    this.data.set(null);
    this.load();
  }

  // ---------- Reading a client ----------

  protected monthKey(index: number): string {
    return `${this.year()}-${String(index + 1).padStart(2, '0')}`;
  }

  protected monthOf(client: DeclarationClient, month: string): DeclarationMonth | null {
    return client.months.find((m) => m.month === month) ?? null;
  }

  // Where a client stands for the reporting month
  protected stage(client: DeclarationClient): Filter {
    if (client.status === 'pending') return 'pending';
    const m = this.monthOf(client, this.reportingMonth());
    if (!m || m.income === null) return 'missing';
    // Declarations filed in the old system are in the folder but have no delivery date
    return m.deliveredAt || m.declarationFile ? 'delivered' : 'waiting';
  }

  // Opens a client's panel, on a month (a cell) or on the reporting month
  protected open(client: DeclarationClient, index?: number): void {
    const same = this.openKey() === client.key;
    if (index === undefined && same) {
      this.openKey.set(null);
      return;
    }
    this.openKey.set(client.key);
    this.month.set(
      index !== undefined
        ? this.monthKey(index)
        : this.showsReporting()
          ? this.reportingMonth()
          : `${this.year()}-12`,
    );
    this.notice.set(null);
  }

  protected monthName(month: string): string {
    return month ? `${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}` : '';
  }

  // ---------- Changes ----------

  // Empty = clear the figure; otherwise a number of GEL
  private figure(value: string, label: string): number | null | undefined {
    if (value.trim() === '') return null;
    const n = Number(value);
    if (!(n >= 0)) {
      this.error.set(`Enter the ${label} in GEL, or leave it empty.`);
      return undefined;
    }
    return n;
  }

  protected async saveMonth(
    client: DeclarationClient,
    incomeText: string,
    taxText: string,
  ): Promise<void> {
    const income = this.figure(incomeText, 'income');
    const tax = this.figure(taxText, 'tax');
    if (income === undefined || tax === undefined) return;
    const old = this.openMonth();
    const figures: { income?: number | null; tax?: number | null } = {};
    if (income !== (old?.income ?? null)) figures.income = income;
    if (tax !== (old?.tax ?? null)) figures.tax = tax;
    if (!Object.keys(figures).length) {
      this.notice.set('Nothing changed.');
      return;
    }
    await this.run(`${this.monthName(this.month())} saved.`, () =>
      this.admin.setDeclarationMonth(client.key, this.month(), figures),
    );
  }

  protected async deliver(client: DeclarationClient, input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    if (!file) {
      this.error.set('Choose the declaration PDF first.');
      return;
    }
    if (file.type !== 'application/pdf') {
      this.error.set('The declaration must be a PDF.');
      return;
    }
    const testing = this.data()?.sending !== 'live';
    const noTax =
      this.openMonth()?.tax == null
        ? '\nThe tax for this month is empty: the message will leave it out.'
        : '';
    if (
      !confirm(
        `Deliver ${this.monthName(this.month())} to ${client.name}?${noTax}${testing ? '\n(Test mode: it comes to you.)' : ''}`,
      )
    )
      return;
    const done = await this.run('', async () => {
      const result = await this.admin.deliverDeclaration(
        client.key,
        this.month(),
        await readUpload(file),
      );
      this.notice.set(`Delivered by ${result.deliveredVia}.`);
    });
    if (done) input.value = '';
  }

  protected async resend(client: DeclarationClient): Promise<void> {
    if (!confirm(`Send ${this.monthName(this.month())} to ${client.name} again?`)) return;
    await this.run('', async () => {
      const result = await this.admin.deliverDeclaration(client.key, this.month());
      this.notice.set(`Sent again by ${result.deliveredVia}.`);
    });
  }

  protected async saveDebt(client: DeclarationClient, value: string): Promise<void> {
    const amount = Number(value || 0);
    if (!(amount >= 0)) {
      this.error.set('Enter the debt in GEL.');
      return;
    }
    await this.run('Outstanding debt saved.', () =>
      this.admin.setDeclarationDebt(client.key, amount),
    );
  }

  protected async saveContacts(
    client: DeclarationClient,
    form: HTMLFormElement,
    event: Event,
  ): Promise<void> {
    event.preventDefault();
    const field = (name: string) =>
      (form.elements.namedItem(name) as HTMLInputElement).value.trim();
    await this.run('Details saved.', () =>
      this.admin.setDeclarationContacts(client.key, {
        registrationId: field('registrationId'),
        telegramId: field('telegramId'),
        email: field('email'),
      }),
    );
  }

  protected async setStatus(client: DeclarationClient, status: 'active' | 'ended'): Promise<void> {
    const question =
      status === 'ended'
        ? `End the service for ${client.name}? They can't report any more, and from next year they leave the list.`
        : `Start the service again for ${client.name}?`;
    if (!confirm(question)) return;
    await this.run(status === 'ended' ? 'Service ended.' : 'Service active again.', () =>
      this.admin.setDeclarationStatus(client.key, status),
    );
  }

  protected async verify(client: DeclarationClient): Promise<void> {
    if (!confirm(`Verify ${client.name} (${client.registrationId})? Check their identity first.`))
      return;
    await this.run(`${client.name} is verified and has a client folder.`, () =>
      this.admin.verifyDeclarationClient(client.key),
    );
  }

  protected async saveSettings(form: HTMLFormElement, event: Event): Promise<void> {
    event.preventDefault();
    const field = (name: string) =>
      (form.elements.namedItem(name) as HTMLInputElement).value.trim();
    const sending = field('sending') as DeclarationSettings['sending'];
    if (
      sending === 'live' &&
      this.settings()?.sending !== 'live' &&
      !confirm('Go live? Declarations and bot messages will reach real clients.')
    )
      return;
    const done = await this.run('Settings saved.', async () => {
      this.settings.set(
        await this.admin.declarationSettings({
          sending,
          feePerDeclaration: Number(field('feePerDeclaration')),
          bankAccount: field('bankAccount'),
          testTelegramId: field('testTelegramId'),
          testEmail: field('testEmail'),
          notifyEmail: field('notifyEmail'),
        }),
      );
    });
    if (done) this.settingsOpen.set(false);
  }

  // Runs one change, then reloads the list so every figure is fresh
  private async run(message: string, change: () => Promise<unknown>): Promise<boolean> {
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    try {
      await change();
      if (message) this.notice.set(message);
      await this.load();
      return true;
    } catch (error) {
      this.error.set(adminErrorMessage(error));
      return false;
    } finally {
      this.busy.set(false);
    }
  }
}
