import { Component, PLATFORM_ID, computed, effect, inject, signal } from '@angular/core';
import { DatePipe, NgTemplateOutlet, isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AdminService } from '../../../core/services/admin.service';
import { Amounts, Dashboard, Period } from '../../../core/models/admin';
import { Shape } from '../../../shared/kit/shapes/shape';
import { AdminBarChart, BarPoint } from '../admin-bar-chart/admin-bar-chart';
import { AdminPeriod, lastDays } from '../admin-period/admin-period';
import { actionLabel, targetLabel } from '../admin-audit';
import { adminErrorMessage } from '../admin-links';

interface Tile {
  value: string;
  label: string;
  sub?: string;
  link?: string;
  // Something needs the admin's attention
  alert?: boolean;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const STATUS_LABELS: Record<string, string> = {
  placed: 'Placed',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

// "120.00 GEL · 40.00 USD", or "0.00 GEL" when there is nothing
export function amounts(a: Amounts | null | undefined): string {
  const list = Object.entries(a ?? {}).filter(([, n]) => n);
  return list.length ? list.map(([cur, n]) => `${n.toFixed(2)} ${cur}`).join(' · ') : '0.00 GEL';
}

// The Admin Control Panel's start page: the whole business for a period
@Component({
  selector: 'app-admin-dashboard-page',
  imports: [DatePipe, NgTemplateOutlet, RouterLink, Shape, AdminBarChart, AdminPeriod],
  templateUrl: './admin-dashboard-page.html',
  styleUrl: './admin-dashboard-page.scss',
})
export class AdminDashboardPage {
  private readonly admin = inject(AdminService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  protected readonly period = signal<Period>(lastDays(30));
  protected readonly data = signal<Dashboard | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly actionLabel = actionLabel;
  protected readonly reasons = {
    failed: 'failed',
    late: 'past its deadline',
    still: 'waiting since',
  };
  protected readonly targetLabel = targetLabel;

  protected readonly tiles = computed<Tile[]>(() => {
    const d = this.data();
    if (!d) return [];
    return [
      {
        value: String(d.clients.total),
        label: 'Clients',
        sub: `+${d.clients.new} new · ${d.clients.verified} verified`,
        link: '/admin/clients',
      },
      {
        value: String(d.orders.new),
        label: 'New orders',
        sub: `${d.orders.total} in total`,
        link: '/admin/orders',
      },
      { value: amounts(d.revenue), label: 'Revenue received', link: '/admin/orders' },
      {
        value: amounts(d.outstanding.amounts),
        label: 'Outstanding',
        sub: `${d.outstanding.count} unpaid orders`,
        link: '/admin/orders',
      },
      {
        value: String(d.services.active),
        label: 'Active services',
        sub: `of ${d.services.total}`,
        link: '/admin/services',
      },
      {
        value: String(d.lawyers.active),
        label: 'Active lawyers',
        sub: `${d.lawyers.applications} applications waiting`,
        link: '/admin/lawyers',
        alert: d.lawyers.applications > 0,
      },
      {
        value: String(d.tasksWaiting + d.toApprove),
        label: 'Tasks awaiting action',
        sub: `${d.toApprove} to approve`,
        link: '/admin/review',
        alert: d.tasksWaiting + d.toApprove > 0,
      },
      {
        value: String(d.stuck.count),
        label: 'Failed or delayed',
        sub: `failed, late, or still for ${d.stuck.days} days`,
        alert: d.stuck.count > 0,
      },
      {
        value: String(d.errors.count),
        label: 'System errors',
        link: '/admin/logs',
        alert: d.errors.count > 0,
      },
      {
        value: String(d.chat.questions),
        label: 'Chat questions',
        sub: 'asked by visitors and clients',
      },
      {
        value: d.traffic == null ? '—' : String(d.traffic),
        label: 'Website traffic',
        sub: d.traffic == null ? 'not counted yet' : 'visits',
      },
      {
        value: d.aiSpending == null ? '—' : amounts(d.aiSpending),
        label: 'AI spending',
        sub: d.aiSpending == null ? 'set prices in AI Management' : 'from AI usage',
        link: '/admin/ai',
      },
    ];
  });

  // Orders by status, as bars against the busiest status
  protected readonly statuses = computed(() => {
    const by = this.data()?.orders.byStatus;
    if (!by) return [];
    const max = Math.max(1, ...Object.values(by));
    return Object.entries(STATUS_LABELS).map(([key, label]) => ({
      label,
      value: by[key as keyof typeof by] ?? 0,
      width: ((by[key as keyof typeof by] ?? 0) / max) * 100,
    }));
  });

  protected readonly orderPoints = computed<BarPoint[]>(() => this.points((p) => p.orders));
  protected readonly revenuePoints = computed<BarPoint[]>(() => this.points((p) => p.revenue));
  protected readonly currency = computed(() => this.data()?.series.currency ?? 'GEL');
  protected readonly money = (n: number) => `${n.toFixed(2)} ${this.currency()}`;

  constructor() {
    // A new period: the figures load again (in the browser, with the admin's login)
    effect(() => {
      const period = this.period();
      if (this.isBrowser) this.load(period);
    });
  }

  protected async load(period: Period = this.period()): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.data.set(await this.admin.dashboard(period));
    } catch (error) {
      this.error.set(adminErrorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  // "2026-11-28" → "Nov 28"; "2026-11" → "Nov 2026"
  private points(pick: (p: { orders: number; revenue: number }) => number): BarPoint[] {
    const series = this.data()?.series;
    if (!series) return [];
    return series.points.map((p) => {
      const [y, m, d] = p.key.split('-');
      const month = MONTHS[Number(m) - 1];
      return { label: d ? `${month} ${Number(d)}` : `${month} ${y}`, value: pick(p) };
    });
  }
}
