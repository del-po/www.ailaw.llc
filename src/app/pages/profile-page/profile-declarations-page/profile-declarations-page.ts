import { Component, afterNextRender, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { DeclarationsService } from '../../../core/services/declarations.service';
import { OrderService } from '../../../core/services/order.service';
import { authErrorMessage } from '../../../core/services/auth-errors';
import { IncomeEntry, MyDeclarationMonth, MyDeclarations } from '../../../core/models/declarations';
import { Shape } from '../../../shared/kit/shapes/shape';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const CURRENCIES = ['GEL', 'USD', 'EUR', 'GBP'];

// One payment row in the form (amount kept as typed)
interface Row {
  date: string;
  currency: string;
  amount: string;
}

@Component({
  selector: 'app-profile-declarations-page',
  imports: [DatePipe, DecimalPipe, Shape],
  templateUrl: './profile-declarations-page.html',
  styleUrl: './profile-declarations-page.scss',
})
export class ProfileDeclarationsPage {
  private readonly declarations = inject(DeclarationsService);
  private readonly orders = inject(OrderService);
  private readonly route = inject(ActivatedRoute);

  protected readonly currencies = CURRENCIES;

  protected readonly data = signal<MyDeclarations | null>(null);
  protected readonly year = signal(String(new Date().getFullYear()));
  protected readonly error = signal<string | null>(null);
  // The page can't be used: the account isn't linked to the service
  protected readonly blocked = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly downloading = signal<string | null>(null);

  // The form: a month without income, or one row per payment
  protected readonly zero = signal(false);
  protected readonly rows = signal<Row[]>([]);

  protected readonly reportingMonth = computed(() => this.data()?.reportingMonth ?? '');
  protected readonly firstDay = computed(() => this.reportingMonth() + '-01');
  protected readonly lastDay = computed(() => {
    const [y, m] = this.reportingMonth().split('-').map(Number);
    return y
      ? `${this.reportingMonth()}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
      : '';
  });
  protected readonly reported = computed(
    () => this.data()?.months.find((m) => m.month === this.reportingMonth()) ?? null,
  );
  protected readonly years = computed(() => {
    const now = new Date().getFullYear();
    return [now, now - 1, now - 2].map(String);
  });
  // Every month of the year on screen, newest first
  protected readonly table = computed(() => {
    const byMonth = new Map((this.data()?.months ?? []).map((m) => [m.month, m]));
    return Array.from({ length: 12 }, (_, i) => `${this.year()}-${String(12 - i).padStart(2, '0')}`)
      .filter((month) => month <= this.reportingMonth() || byMonth.has(month))
      .map(
        (month) =>
          byMonth.get(month) ??
          ({
            month,
            income: null,
            tax: null,
            reportedAt: '',
            deliveredAt: '',
            fileId: '',
          } as MyDeclarationMonth),
      );
  });
  protected readonly penalty = computed(
    () => Math.round((this.data()?.outstandingDebt ?? 0) * 0.0005 * 100) / 100,
  );

  constructor() {
    afterNextRender(() => this.load(true));
  }

  protected async load(first = false): Promise<void> {
    this.error.set(null);
    try {
      this.data.set(await this.declarations.mine(this.year()));
      if (first) await this.startForm();
    } catch (error) {
      const code = (error as Error)?.message;
      if (code === 'NOT_A_DECLARATIONS_CLIENT' || code === 'VERIFICATION_PENDING')
        this.blocked.set(authErrorMessage(error));
      else this.error.set(authErrorMessage(error));
    }
  }

  // A draft from the chat ("Edit" on its card) fills the form; otherwise one empty row
  private async startForm(): Promise<void> {
    const draftId = this.route.snapshot.queryParamMap.get('draft');
    if (draftId) {
      try {
        const draft = await this.declarations.draft(draftId);
        if (draft.month === this.reportingMonth()) {
          this.zero.set(!draft.entries.length);
          this.rows.set(
            draft.entries.map((e) => ({
              date: e.date,
              currency: e.currency,
              amount: String(e.amount),
            })),
          );
          if (draft.entries.length) return;
        }
      } catch {
        // An unknown draft just leaves the form empty
      }
    }
    if (!this.rows().length) this.addRow();
  }

  protected pickYear(year: string): void {
    this.year.set(year);
    this.load();
  }

  protected monthName(month: string): string {
    return month ? `${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}` : '';
  }

  // ---------- The form ----------

  protected addRow(): void {
    this.rows.update((rows) => [...rows, { date: '', currency: 'GEL', amount: '' }]);
  }

  protected removeRow(index: number): void {
    this.rows.update((rows) => rows.filter((_, i) => i !== index));
  }

  protected setRow(index: number, key: keyof Row, value: string): void {
    this.rows.update((rows) => rows.map((r, i) => (i === index ? { ...r, [key]: value } : r)));
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    this.error.set(null);
    this.notice.set(null);
    let entries: IncomeEntry[] = [];
    if (!this.zero()) {
      const rows = this.rows().filter((r) => r.date || r.amount);
      if (!rows.length) {
        this.error.set(authErrorMessage(new Error('NO_INCOME_ENTRIES')));
        return;
      }
      if (rows.some((r) => !r.date || !/^\d+(\.\d+)?$/.test(r.amount.trim()))) {
        this.error.set('Each payment needs a date and an amount (numbers only, like 1234.56).');
        return;
      }
      entries = rows.map((r) => ({ date: r.date, currency: r.currency, amount: Number(r.amount) }));
    }
    const month = this.monthName(this.reportingMonth());
    const what = this.zero()
      ? 'no income'
      : `${entries.length} payment${entries.length > 1 ? 's' : ''}`;
    const replaces =
      this.reported()?.income != null ? ' This replaces what you reported before.' : '';
    if (!confirm(`Report ${what} for ${month}?${replaces}`)) return;

    this.busy.set(true);
    try {
      const saved = await this.declarations.report(this.zero() ? { zero: true } : { entries });
      this.notice.set(
        `Saved: ${month}, ${saved.income.toFixed(2)} GEL, tax ${saved.tax.toFixed(2)} GEL.`,
      );
      await this.load();
    } catch (error) {
      this.error.set(authErrorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  // ---------- Declarations ----------

  protected async download(month: MyDeclarationMonth): Promise<void> {
    this.downloading.set(month.month);
    this.error.set(null);
    try {
      const result = await this.orders.document(month.fileId);
      const bytes = Uint8Array.from(atob(result.data), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: result.mimeType }));
      const link = document.createElement('a');
      link.href = url;
      link.download = result.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (error) {
      this.error.set(authErrorMessage(error));
    } finally {
      this.downloading.set(null);
    }
  }
}
