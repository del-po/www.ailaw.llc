import { Component, PLATFORM_ID, computed, effect, inject, signal } from '@angular/core';
import { DatePipe, JsonPipe, KeyValuePipe, isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { AdminService } from '../../../core/services/admin.service';
import { AuditEntry, ErrorEntry, Period } from '../../../core/models/admin';
import { Shape } from '../../../shared/kit/shapes/shape';
import { AdminPeriod, lastDays } from '../admin-period/admin-period';
import { actionLabel, shown, targetLabel } from '../admin-audit';
import { adminErrorMessage } from '../admin-links';

type Tab = 'activity' | 'errors';
type Via = 'all' | 'panel' | 'chat' | 'failed';

// Analytics & Logs: the audit log (every admin change, from the panel or
// the chat, with before → after values) and the system error log
@Component({
  selector: 'app-admin-logs-page',
  imports: [DatePipe, JsonPipe, KeyValuePipe, Shape, AdminPeriod],
  templateUrl: './admin-logs-page.html',
  styleUrl: './admin-logs-page.scss',
})
export class AdminLogsPage {
  private readonly admin = inject(AdminService);
  private readonly router = inject(Router);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  protected readonly tabs: { value: Tab; label: string }[] = [
    { value: 'activity', label: 'Admin activity' },
    { value: 'errors', label: 'System errors' },
  ];
  protected readonly vias: { value: Via; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'panel', label: 'Panel' },
    { value: 'chat', label: 'Chat' },
    { value: 'failed', label: 'Failed' },
  ];

  protected readonly tab = signal<Tab>(
    inject(ActivatedRoute).snapshot.queryParamMap.get('tab') === 'errors' ? 'errors' : 'activity',
  );
  protected readonly period = signal<Period>(lastDays(30));
  protected readonly via = signal<Via>('all');
  protected readonly search = signal('');

  protected readonly activity = signal<AuditEntry[] | null>(null);
  protected readonly errors = signal<ErrorEntry[] | null>(null);
  protected readonly error = signal<string | null>(null);
  // The line opened to show its details
  protected readonly openId = signal<string | null>(null);

  protected readonly actionLabel = actionLabel;
  protected readonly targetLabel = targetLabel;
  protected readonly shown = shown;

  // Filtered here, so typing doesn't ask the server every time
  private readonly words = computed(() => this.search().toLowerCase().split(/\s+/).filter(Boolean));

  protected readonly activityList = computed(() => {
    const via = this.via();
    const words = this.words();
    return (this.activity() ?? [])
      .filter((a) => via === 'all' || (via === 'failed' ? !a.ok : a.via === via))
      .filter((a) => {
        const text = [actionLabel(a.action), a.action, a.who, a.email, targetLabel(a), a.error]
          .join(' ')
          .toLowerCase();
        return words.every((w) => text.includes(w));
      });
  });

  protected readonly errorList = computed(() => {
    const words = this.words();
    return (this.errors() ?? []).filter((e) => {
      const text = [e.action, e.error, e.details].join(' ').toLowerCase();
      return words.every((w) => text.includes(w));
    });
  });

  constructor() {
    effect(() => {
      const tab = this.tab();
      const period = this.period();
      if (this.isBrowser) this.load(tab, period);
    });
  }

  protected setTab(tab: Tab): void {
    this.tab.set(tab);
    this.openId.set(null);
    this.router.navigate([], {
      queryParams: { tab: tab === 'errors' ? 'errors' : null },
      replaceUrl: true,
    });
  }

  protected toggle(id: string): void {
    this.openId.update((open) => (open === id ? null : id));
  }

  private async load(tab: Tab, period: Period): Promise<void> {
    this.error.set(null);
    try {
      if (tab === 'activity')
        this.activity.set(await this.admin.auditLog({ ...period, limit: 500 }));
      else this.errors.set(await this.admin.errorLog({ ...period, limit: 500 }));
    } catch (error) {
      this.error.set(adminErrorMessage(error));
    }
  }
}
