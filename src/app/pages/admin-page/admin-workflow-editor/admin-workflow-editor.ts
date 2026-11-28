import { Component, inject, input, output, signal } from '@angular/core';
import { AdminService } from '../../../core/services/admin.service';
import { ServiceWorkflow, StepConfig, WorkflowStep } from '../../../core/models/admin';
import { Shape } from '../../../shared/kit/shapes/shape';
import { CAPABILITY_LABELS } from '../admin-order-page/admin-order-page';
import { adminErrorMessage } from '../admin-links';

// Settings the editor has its own controls for; anything else a step carries
// (e.g. calculate's base, rate, output) is edited as JSON
const KNOWN = ['needsFile', 'needsApproval', 'dueDays', 'email'];

// A row being edited: the step, plus its extra settings as text
interface Draft extends WorkflowStep {
  extra: string;
}

// The workflow of one service: the steps every new order of it runs, in
// order. AI Law's own steps (chat) do a kind of work; a lawyer's step waits
// for a lawyer, optionally with a deadline and AI Law's approval.
@Component({
  selector: 'app-admin-workflow-editor',
  imports: [Shape],
  templateUrl: './admin-workflow-editor.html',
  styleUrl: './admin-workflow-editor.scss',
})
export class AdminWorkflowEditor {
  private readonly admin = inject(AdminService);

  readonly slug = input.required<string>();
  readonly closed = output<void>();

  protected readonly labels = CAPABILITY_LABELS;
  protected readonly data = signal<ServiceWorkflow | null>(null);
  protected readonly steps = signal<Draft[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly busy = signal(false);

  constructor() {
    queueMicrotask(() => this.load());
  }

  private async load(): Promise<void> {
    try {
      const data = await this.admin.getWorkflow(this.slug());
      this.data.set(data);
      this.steps.set(data.workflow.map((s) => this.draft(s)));
    } catch (error) {
      this.error.set(adminErrorMessage(error));
    }
  }

  private draft(step: WorkflowStep): Draft {
    const config = typeof step.config === 'string' ? safeJson(step.config) : (step.config ?? {});
    const extra = Object.fromEntries(Object.entries(config).filter(([k]) => !KNOWN.includes(k)));
    return {
      owner: step.owner === 'lawyer' ? 'lawyer' : 'chat',
      capability: step.owner === 'lawyer' ? 'task' : step.capability || 'collect',
      clientLabel: step.clientLabel || '',
      lawyerTask: step.lawyerTask || '',
      config: {
        needsFile: config.needsFile === true,
        needsApproval: config.needsApproval === true,
        dueDays: Number(config.dueDays) || 0,
        email: config.email !== false,
      },
      extra: Object.keys(extra).length ? JSON.stringify(extra) : '',
    };
  }

  // The plugin's steps as a starting point (what chat orders run today)
  protected copyPluginSteps(): void {
    this.steps.set((this.data()?.pluginSteps ?? []).map((s) => this.draft(s)));
  }

  protected add(): void {
    this.steps.update((list) => [
      ...list,
      this.draft({
        owner: 'lawyer',
        capability: 'task',
        clientLabel: '',
        lawyerTask: '',
        config: {},
      }),
    ]);
  }

  protected remove(i: number): void {
    this.steps.update((list) => list.filter((_, n) => n !== i));
  }

  protected moveStep(i: number, by: -1 | 1): void {
    this.steps.update((list) => {
      const next = [...list];
      const j = i + by;
      if (j < 0 || j >= next.length) return list;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  protected set<K extends keyof Draft>(i: number, key: K, value: Draft[K]): void {
    this.steps.update((list) =>
      list.map((s, n) => {
        if (n !== i) return s;
        const next = { ...s, [key]: value };
        if (key === 'owner') next.capability = value === 'lawyer' ? 'task' : 'collect';
        return next;
      }),
    );
  }

  protected setConfig(i: number, key: keyof StepConfig, value: boolean | number): void {
    this.steps.update((list) =>
      list.map((s, n) => (n === i ? { ...s, config: { ...s.config, [key]: value } } : s)),
    );
  }

  protected async save(): Promise<void> {
    let steps: WorkflowStep[];
    try {
      steps = this.steps().map(({ extra, ...s }) => ({
        ...s,
        config: { ...s.config, ...(extra.trim() ? JSON.parse(extra) : {}) },
      }));
    } catch {
      this.error.set('The extra settings of a step aren’t valid JSON.');
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    try {
      const data = await this.admin.setWorkflow(this.slug(), steps);
      this.data.set(data);
      this.steps.set(data.workflow.map((s) => this.draft(s)));
      this.notice.set(
        'Saved. New orders of this service run these steps; placed orders keep theirs.',
      );
    } catch (error) {
      this.error.set(adminErrorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}

function safeJson(text: string): StepConfig {
  try {
    return JSON.parse(text) as StepConfig;
  } catch {
    return {};
  }
}
