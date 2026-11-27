import { Component, afterNextRender, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { AdminService } from '../../../core/services/admin.service';
import { AdminChatService } from '../../../core/services/admin-chat.service';
import { AuthService } from '../../../core/services/auth.service';
import { OrderService } from '../../../core/services/order.service';
import { ADMIN_SECTIONS, AdminSection } from '../admin-links';

// The admin Workspace, laid out like the lawyers' one: a sidebar (the chat
// and its conversations, the sections with what is waiting in each, the
// profile menu) and the main area, where the chat or a section opens.
// The admin guard has already checked the role before this loads.
@Component({
  selector: 'app-admin-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './admin-layout.html',
  styleUrl: './admin-layout.scss',
})
export class AdminLayout {
  protected readonly auth = inject(AuthService);
  protected readonly chat = inject(AdminChatService);
  private readonly admin = inject(AdminService);
  private readonly orders = inject(OrderService);
  private readonly router = inject(Router);

  protected readonly sections = ADMIN_SECTIONS;
  // What is waiting in each section; null until loaded (or when it failed)
  protected readonly counts = signal<Partial<Record<NonNullable<AdminSection['count']>, number>>>(
    {},
  );
  protected readonly menuOpen = signal(false);

  protected readonly name = computed(
    () => this.auth.profile()?.DisplayName || this.auth.user()?.displayName || 'Admin',
  );

  constructor() {
    afterNextRender(() => {
      this.loadCounts();
      // Figures change as the admin works: refresh them on every page change
      this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => {
        this.loadCounts();
        this.menuOpen.set(false);
      });
    });
  }

  // Each number comes on its own; one failing leaves just that one empty
  private loadCounts(): void {
    const set = (key: NonNullable<AdminSection['count']>, n: number) =>
      this.counts.update((c) => ({ ...c, [key]: n }));
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

  protected newChat(): void {
    this.chat.newChat();
    this.router.navigateByUrl('/admin');
  }

  protected openChat(id: string): void {
    this.chat.open(id);
    this.router.navigateByUrl('/admin');
  }

  protected async signOut(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigateByUrl('/login');
  }
}
