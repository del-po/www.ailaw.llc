import { Component, PLATFORM_ID, computed, effect, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe, NgTemplateOutlet, isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AdminService } from '../../../core/services/admin.service';
import {
  AiMistake,
  AiOverview,
  AiPlugin,
  AiTestResult,
  AiUsage,
  AiVersion,
  Instruction,
  KnowledgeItem,
  ModelSettings,
  Period,
  Side,
} from '../../../core/models/admin';
import { Shape } from '../../../shared/kit/shapes/shape';
import { AdminPeriod, lastDays } from '../admin-period/admin-period';
import { adminErrorMessage } from '../admin-links';

type Tab = 'models' | 'instructions' | 'plugins' | 'test' | 'usage' | 'mistakes';

export const SIDE_LABELS: Record<Side, string> = {
  client: 'Client assistant',
  lawyer: 'Lawyer assistant',
  admin: 'Admin Assistant',
};

const SHARED_FIELDS: {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select';
  options?: string[];
}[] = [
  { key: 'Provider', label: 'Provider', type: 'select', options: ['gemini', 'openai'] },
  { key: 'Model', label: 'Model', type: 'text' },
  { key: 'MaxAnswerTokens', label: 'Longest answer · tokens', type: 'number' },
  { key: 'Temperature', label: 'Temperature · 0 to 2', type: 'number' },
  {
    key: 'ReasoningEffort',
    label: 'Reasoning effort',
    type: 'select',
    options: ['low', 'medium', 'high'],
  },
  { key: 'HistoryMessages', label: 'Earlier messages it reads', type: 'number' },
  { key: 'GuestQuestionsPerDay', label: 'Questions a day · visitors', type: 'number' },
  { key: 'UserQuestionsPerDay', label: 'Questions a day · clients', type: 'number' },
];
// What one assistant may set for itself
const OWN_KEYS = ['Provider', 'Model', 'MaxAnswerTokens', 'Temperature', 'ReasoningEffort'];

// AI Management: which models the assistants use, their instructions (with
// versions), the plugins and their know-how, a test bench, usage and cost,
// and the answers marked as mistakes
@Component({
  selector: 'app-admin-ai-page',
  imports: [DatePipe, DecimalPipe, NgTemplateOutlet, RouterLink, Shape, AdminPeriod],
  templateUrl: './admin-ai-page.html',
  styleUrl: './admin-ai-page.scss',
})
export class AdminAiPage {
  private readonly admin = inject(AdminService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  protected readonly tabs: { value: Tab; label: string }[] = [
    { value: 'models', label: 'Models' },
    { value: 'instructions', label: 'Instructions' },
    { value: 'plugins', label: 'Plugins & knowledge' },
    { value: 'test', label: 'Test' },
    { value: 'usage', label: 'Usage & cost' },
    { value: 'mistakes', label: 'Mistakes' },
  ];
  protected readonly sides: Side[] = ['client', 'lawyer', 'admin'];
  protected readonly sideLabels = SIDE_LABELS;
  protected readonly sharedFields = SHARED_FIELDS;
  protected readonly ownFields = SHARED_FIELDS.filter((f) => OWN_KEYS.includes(f.key));

  protected readonly tab = signal<Tab>('models');
  protected readonly data = signal<AiOverview | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly busy = signal(false);

  constructor() {
    if (this.isBrowser) this.load();
    // Usage and mistakes load when their tab opens, and again for a new period
    effect(() => {
      const tab = this.tab();
      const period = this.period();
      if (!this.isBrowser) return;
      if (tab === 'usage') this.loadUsage(period);
      if (tab === 'mistakes') this.loadMistakes();
    });
  }

  private async load(): Promise<void> {
    try {
      this.data.set(await this.admin.aiOverview());
      this.pickSide(this.side());
    } catch (error) {
      this.error.set(adminErrorMessage(error));
    }
  }

  // Runs one change; the page shows the settings as they are after it
  private async run(change: () => Promise<AiOverview>, done: string): Promise<boolean> {
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    try {
      this.data.set(await change());
      this.notice.set(done);
      return true;
    } catch (error) {
      this.error.set(adminErrorMessage(error));
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  protected setTab(tab: Tab): void {
    this.tab.set(tab);
    this.error.set(null);
    this.notice.set(null);
  }

  // ---------- Models ----------

  protected value(settings: ModelSettings, key: string): string {
    return String(settings[key] ?? '');
  }

  private read(form: HTMLFormElement, keys: string[]): ModelSettings {
    return Object.fromEntries(
      keys.map((k) => [k, (form.elements.namedItem(k) as HTMLInputElement).value.trim()]),
    );
  }

  protected saveShared(form: HTMLFormElement, event: Event): void {
    event.preventDefault();
    this.run(
      () =>
        this.admin.setModel(
          '',
          this.read(
            form,
            SHARED_FIELDS.map((f) => f.key),
          ),
        ),
      'Saved. Every assistant without its own settings uses these.',
    );
  }

  protected saveOwn(side: Side, form: HTMLFormElement, event: Event): void {
    event.preventDefault();
    this.run(
      () => this.admin.setModel(side, this.read(form, OWN_KEYS)),
      `Saved for the ${SIDE_LABELS[side]}.`,
    );
  }

  protected own(side: Side): ModelSettings {
    return this.data()?.assistants.find((a) => a.side === side)?.ai ?? {};
  }

  // ---------- Instructions ----------

  protected readonly side = signal<Side>('client');
  // The instructions being edited (a copy until saved)
  protected readonly draft = signal<Instruction[]>([]);
  protected readonly versions = signal<AiVersion[] | null>(null);

  protected pickSide(side: Side): void {
    this.side.set(side);
    this.versions.set(null);
    const list = this.data()?.assistants.find((a) => a.side === side)?.instructions ?? [];
    this.draft.set(list.map((i) => ({ ...i })));
  }

  protected setInstruction(i: number, key: keyof Instruction, value: string | boolean): void {
    this.draft.update((list) => list.map((x, n) => (n === i ? { ...x, [key]: value } : x)));
  }

  protected addInstruction(): void {
    this.draft.update((list) => [
      ...list,
      { title: '', text: '', order: list.length + 1, active: true },
    ]);
  }

  protected removeInstruction(i: number): void {
    this.draft.update((list) => list.filter((_, n) => n !== i));
  }

  protected moveInstruction(i: number, by: -1 | 1): void {
    this.draft.update((list) => {
      const j = i + by;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  protected async saveInstructions(): Promise<void> {
    const side = this.side();
    const done = await this.run(
      () => this.admin.setInstructions(side, this.draft()),
      'Saved. The version before is kept.',
    );
    if (done) this.pickSide(side);
  }

  protected async showVersions(of: { side?: Side; pluginId?: string }): Promise<void> {
    this.error.set(null);
    try {
      this.versions.set(await this.admin.aiVersions(of));
    } catch (error) {
      this.error.set(adminErrorMessage(error));
    }
  }

  protected async restore(
    of: { side?: Side; pluginId?: string },
    version: AiVersion,
  ): Promise<void> {
    if (
      !confirm(
        `Bring back the version saved ${new Date(version.savedAt).toLocaleString()}? The current one is kept.`,
      )
    )
      return;
    const done = await this.run(
      () => this.admin.restoreVersion(of, version.id),
      'Version restored.',
    );
    if (done) {
      this.versions.set(null);
      if (of.side) this.pickSide(of.side);
      if (of.pluginId) this.openPlugin(of.pluginId);
    }
  }

  // ---------- Plugins and knowledge ----------

  protected readonly pluginId = signal<string | null>(null);
  protected readonly knowledge = signal<KnowledgeItem[]>([]);

  protected readonly plugin = computed(
    () => this.data()?.plugins.find((p) => p.id === this.pluginId()) ?? null,
  );

  protected openPlugin(id: string): void {
    this.versions.set(null);
    this.pluginId.set(id);
    const p = this.data()?.plugins.find((x) => x.id === id);
    this.knowledge.set((p?.items ?? []).map((i) => ({ ...i, audience: [...i.audience] })));
  }

  protected togglePlugin(p: AiPlugin): void {
    if (p.enabled && !confirm(`Switch ${p.id} off? Every assistant stops using it at once.`))
      return;
    this.run(
      () => this.admin.setPlugin(p.id, { enabled: !p.enabled }),
      `${p.id} is ${p.enabled ? 'off' : 'on'}.`,
    );
  }

  protected toggleSide(p: AiPlugin, side: Side): void {
    const sides = p.sides.includes(side) ? p.sides.filter((s) => s !== side) : [...p.sides, side];
    this.run(() => this.admin.setPlugin(p.id, { sides }), `${p.id}: assistants changed.`);
  }

  protected setItem(i: number, key: keyof KnowledgeItem, value: string | boolean): void {
    this.knowledge.update((list) => list.map((x, n) => (n === i ? { ...x, [key]: value } : x)));
  }

  protected toggleAudience(i: number, side: Side): void {
    this.knowledge.update((list) =>
      list.map((x, n) =>
        n !== i
          ? x
          : {
              ...x,
              audience: x.audience.includes(side)
                ? x.audience.filter((a) => a !== side)
                : [...x.audience, side],
            },
      ),
    );
  }

  protected addItem(): void {
    this.knowledge.update((list) => [
      ...list,
      { title: '', text: '', audience: ['client'], active: true },
    ]);
  }

  protected removeItem(i: number): void {
    this.knowledge.update((list) => list.filter((_, n) => n !== i));
  }

  protected async saveKnowledge(): Promise<void> {
    const id = this.pluginId();
    if (!id) return;
    const done = await this.run(
      () => this.admin.setKnowledge(id, this.knowledge()),
      'Know-how saved. The version before is kept.',
    );
    if (done) this.openPlugin(id);
  }

  // ---------- Test ----------

  protected readonly testResult = signal<AiTestResult | null>(null);

  // With the instructions being edited (unsaved), so a change can be tried first
  protected async test(side: Side, question: string, useDraft: boolean): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    this.testResult.set(null);
    try {
      this.testResult.set(
        await this.admin.testAi(
          side,
          question,
          useDraft && side === this.side() ? this.draft() : undefined,
        ),
      );
    } catch (error) {
      this.error.set(adminErrorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  // ---------- Usage and cost ----------

  protected readonly period = signal<Period>(lastDays(30));
  protected readonly usage = signal<AiUsage | null>(null);

  private async loadUsage(period: Period): Promise<void> {
    try {
      this.usage.set(await this.admin.aiUsage(period));
    } catch (error) {
      this.error.set(adminErrorMessage(error));
    }
  }

  protected readonly priceRows = computed(() => {
    const prices = this.data()?.prices ?? {};
    // Every model used or priced, so a new one can be given a price
    const models = new Set([
      ...Object.keys(prices),
      ...(this.usage()?.lines.map((l) => l.model) ?? []),
    ]);
    return [...models]
      .sort()
      .map((model) => ({ model, ...(prices[model] ?? { input: 0, output: 0 }) }));
  });

  protected savePrices(form: HTMLFormElement, event: Event): void {
    event.preventDefault();
    const value = (name: string) =>
      Number((form.elements.namedItem(name) as HTMLInputElement | null)?.value || 0);
    const prices: AiOverview['prices'] = {};
    for (const row of this.priceRows()) {
      prices[row.model] = { input: value('in-' + row.model), output: value('out-' + row.model) };
    }
    const added = (form.elements.namedItem('newModel') as HTMLInputElement).value.trim();
    if (added) prices[added] = { input: value('newIn'), output: value('newOut') };
    this.run(() => this.admin.setPrices(prices), 'Prices saved.').then(() =>
      this.loadUsage(this.period()),
    );
  }

  // ---------- Mistakes ----------

  protected readonly mistakes = signal<AiMistake[] | null>(null);

  private async loadMistakes(): Promise<void> {
    try {
      this.mistakes.set(await this.admin.aiMistakes());
    } catch (error) {
      this.error.set(adminErrorMessage(error));
    }
  }

  protected async resolve(m: AiMistake, resolution: string): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      this.mistakes.set(await this.admin.resolveMistake(m.id, resolution));
    } catch (error) {
      this.error.set(adminErrorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
