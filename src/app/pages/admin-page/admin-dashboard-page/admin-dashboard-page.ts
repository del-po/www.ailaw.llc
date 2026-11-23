import { Component, afterNextRender, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AdminService } from '../../../core/services/admin.service';
import { BlogService } from '../../../core/services/blog.service';
import { AdminServiceRow } from '../../../core/models/admin';
import { Profile } from '../../../core/models/profile';
import { Shape } from '../../../shared/kit/shapes/shape';
import { ADMIN_SECTIONS, adminErrorMessage } from '../admin-links';

interface Tile {
  value: string;
  label: string;
  link: string;
}

@Component({
  selector: 'app-admin-dashboard-page',
  imports: [RouterLink, Shape],
  templateUrl: './admin-dashboard-page.html',
  styleUrl: './admin-dashboard-page.scss',
})
export class AdminDashboardPage {
  private readonly admin = inject(AdminService);
  private readonly blog = inject(BlogService);

  protected readonly sections = ADMIN_SECTIONS.slice(1);

  private readonly services = signal<AdminServiceRow[] | null>(null);
  private readonly clients = signal<Profile[] | null>(null);
  private readonly posts = signal<number | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly tiles = computed<Tile[]>(() => {
    const services = this.services();
    const clients = this.clients();
    const count = (n: number | undefined | null) => (n == null ? '…' : String(n));

    return [
      {
        value: count(services?.filter((s) => s.Status === 'Active').length),
        label: 'Active services',
        link: '/admin/services',
      },
      {
        value: count(services?.filter((s) => s.Status === 'Draft').length),
        label: 'Drafts',
        link: '/admin/services',
      },
      {
        value: count(clients?.filter((c) => c.Role === 'client').length),
        label: 'Clients',
        link: '/admin/clients',
      },
      { value: count(this.posts()), label: 'Articles', link: '/admin/blog' },
    ];
  });

  constructor() {
    afterNextRender(() => this.load());
  }

  private async load(): Promise<void> {
    // Each number loads on its own, so one failure doesn't hide the rest
    const run = async (task: () => Promise<void>) => {
      try {
        await task();
      } catch (error) {
        this.error.set(adminErrorMessage(error));
      }
    };

    await Promise.all([
      run(async () => this.services.set(await this.admin.listServices())),
      run(async () => this.clients.set(await this.admin.listClients())),
      run(async () => this.posts.set((await firstValueFrom(this.blog.getPosts())).length)),
    ]);
  }
}
