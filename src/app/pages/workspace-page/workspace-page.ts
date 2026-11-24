import { Component, afterNextRender, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { WorkspaceService } from '../../core/services/workspace.service';
import { Assignment, StaffMe } from '../../core/models/lawyer';
import { Shape } from '../../shared/kit/shapes/shape';

// The lawyer's Workspace: assignments on the left (open first, then done),
// the chosen assignment on the right. The case chat and profile come next.
@Component({
  selector: 'app-workspace-page',
  imports: [DatePipe, DecimalPipe, Shape],
  templateUrl: './workspace-page.html',
  styleUrl: './workspace-page.scss',
})
export class WorkspacePage {
  private readonly auth = inject(AuthService);
  private readonly workspace = inject(WorkspaceService);
  private readonly router = inject(Router);

  protected readonly me = signal<StaffMe | null>(null);
  protected readonly assignments = signal<Assignment[] | null>(null);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly open = computed(() =>
    (this.assignments() ?? []).filter((a) => a.status !== 'done'),
  );
  protected readonly done = computed(() =>
    (this.assignments() ?? []).filter((a) => a.status === 'done'),
  );
  protected readonly selected = computed(
    () => this.assignments()?.find((a) => a.assignmentId === this.selectedId()) ?? null,
  );

  constructor() {
    afterNextRender(() => this.load());
  }

  private async load(): Promise<void> {
    try {
      // Who I am first: it also activates a newly approved lawyer
      this.me.set(await this.workspace.me());
      await this.refresh();
    } catch {
      this.error.set('Your Workspace could not be opened. If this keeps happening, contact AI Law.');
    }
  }

  protected async refresh(): Promise<void> {
    const list = await this.workspace.assignments();
    this.assignments.set(list);
    // Opens the newest open assignment the first time
    if (!this.selectedId() && list.length) {
      this.selectedId.set((list.find((a) => a.status !== 'done') ?? list[0]).assignmentId);
    }
  }

  protected select(assignment: Assignment): void {
    this.selectedId.set(assignment.assignmentId);
  }

  protected tasks(assignment: Assignment): string[] {
    // "1. File the declaration…" → "File the declaration…": the list numbers them
    return assignment.tasks
      .split('\n')
      .map((t) => t.trim().replace(/^\d+\.\s*/, ''))
      .filter(Boolean);
  }

  protected async signOut(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigateByUrl('/login');
  }
}
