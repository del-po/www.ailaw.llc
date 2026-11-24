import { Component, afterNextRender, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { AdminService } from '../../../core/services/admin.service';
import { AdminLawyer, LawyerStatus } from '../../../core/models/lawyer';
import { Shape } from '../../../shared/kit/shapes/shape';
import { adminErrorMessage } from '../admin-links';

type Filter = 'applied' | 'team' | 'all';

const FILTERS: { id: Filter; label: string; statuses: LawyerStatus[] | null }[] = [
  { id: 'applied', label: 'New applications', statuses: ['applied'] },
  { id: 'team', label: 'Team', statuses: ['approved', 'active', 'suspended'] },
  { id: 'all', label: 'All', statuses: null },
];

// Lawyer applications from the "Join as a lawyer" page. Approving creates
// their login and emails them a link to set a password.
@Component({
  selector: 'app-admin-lawyers-page',
  imports: [DatePipe, Shape],
  templateUrl: './admin-lawyers-page.html',
  styleUrl: './admin-lawyers-page.scss',
})
export class AdminLawyersPage {
  private readonly admin = inject(AdminService);

  protected readonly filters = FILTERS;
  protected readonly lawyers = signal<AdminLawyer[] | null>(null);
  protected readonly filter = signal<Filter>('applied');
  protected readonly search = signal('');
  protected readonly open = signal<string | null>(null);
  protected readonly busyId = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);

  protected readonly list = computed(() => {
    const statuses = FILTERS.find((f) => f.id === this.filter())?.statuses;
    const words = this.search().toLowerCase().split(/\s+/).filter(Boolean);
    return (this.lawyers() ?? []).filter((l) => {
      if (statuses && !statuses.includes(l.status)) return false;
      const text = [l.firstName, l.lastName, l.email, l.lawyerId, l.specializations]
        .join(' ')
        .toLowerCase();
      return words.every((w) => text.includes(w));
    });
  });

  protected readonly pending = computed(
    () => this.lawyers()?.filter((l) => l.status === 'applied').length ?? 0,
  );

  constructor() {
    afterNextRender(() => this.load());
  }

  protected async load(): Promise<void> {
    this.error.set(null);
    try {
      this.lawyers.set(await this.admin.listLawyers());
    } catch (error) {
      this.error.set(adminErrorMessage(error));
    }
  }

  protected toggle(lawyer: AdminLawyer): void {
    this.open.set(this.open() === lawyer.lawyerId ? null : lawyer.lawyerId);
  }

  protected async approve(lawyer: AdminLawyer): Promise<void> {
    const name = `${lawyer.firstName} ${lawyer.lastName}`;
    if (!confirm(`Approve ${name}? They get a login and an email to set their password.`)) return;
    await this.run(lawyer, () => this.admin.approveLawyer(lawyer.lawyerId), `${name} is approved. The invite email is on its way.`);
  }

  protected async reject(lawyer: AdminLawyer): Promise<void> {
    const name = `${lawyer.firstName} ${lawyer.lastName}`;
    if (!confirm(`Decline ${name}? They get a polite email saying so.`)) return;
    await this.run(lawyer, () => this.admin.rejectLawyer(lawyer.lawyerId), `${name} was declined.`);
  }

  private async run(lawyer: AdminLawyer, action: () => Promise<AdminLawyer[]>, done: string): Promise<void> {
    this.busyId.set(lawyer.lawyerId);
    this.error.set(null);
    this.notice.set(null);
    try {
      this.lawyers.set(await action());
      this.notice.set(done);
    } catch (error) {
      this.error.set(adminErrorMessage(error));
    } finally {
      this.busyId.set(null);
    }
  }
}
