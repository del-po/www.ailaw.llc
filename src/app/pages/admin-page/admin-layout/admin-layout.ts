import { Component, afterNextRender, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { AdminService } from '../../../core/services/admin.service';
import { AuthService } from '../../../core/services/auth.service';
import { OrderService } from '../../../core/services/order.service';
import { ADMIN_SECTIONS, AdminCount, AdminSection } from '../admin-links';

// The Admin Control Panel: a sidebar (the Admin Assistant, the sections with
// what is waiting in each, the administrator with Log out) and the main
// area, where the selected section opens. The admin guard has already
// checked the role before this loads; the admin door checks it again on
// every request.
@Component({
  selector: 'app-admin-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './admin-layout.html',
  styleUrl: './admin-layout.scss',
})
export class AdminLayout {
  protected readonly auth = inject(AuthService);
  private readonly admin = inject(AdminService);
  private readonly orders = inject(OrderService);
  private readonly router = inject(Router);

  protected readonly sections = ADMIN_SECTIONS;
  // What is waiting in each section; empty until loaded (or when it failed)
  protected readonly counts = signal<Partial<Record<AdminCount, number>>>({});

  protected readonly name = computed(
    () => this.auth.profile()?.DisplayName || this.auth.user()?.displayName || 'Admin',
  );

  constructor() {
    afterNextRender(() => {
      this.loadCounts();
      // Figures change as the admin works: refresh them on every page change
      this.router.events
        .pipe(filter((e) => e instanceof NavigationEnd))
        .subscribe(() => this.loadCounts());
    });
  }

  // Each number comes on its own; one failing leaves just that one empty
  private loadCounts(): void {
    const set = (key: AdminCount, n: number) => this.counts.update((c) => ({ ...c, [key]: n }));
    this.admin
      .declarationCounts()
      .then((c) => set('declarations', c.notReported + c.toFile + c.toVerify))
      .catch(() => undefined);
    this.orders
      .adminList()
      .then((list) =>
        set('orders', list.filter((o) => ['placed', 'in_progress'].includes(o.orderStatus)).length),
      )
      .catch(() => undefined);
    this.admin
      .reviewTasks()
      .then((list) => set('review', list.length))
      .catch(() => undefined);
    this.admin
      .listLawyers()
      .then((list) => set('lawyers', list.filter((l) => l.status === 'applied').length))
      .catch(() => undefined);
  }

  protected count(section: AdminSection): number {
    return section.count ? (this.counts()[section.count] ?? 0) : 0;
  }

  protected async signOut(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigateByUrl('/login');
  }
}
