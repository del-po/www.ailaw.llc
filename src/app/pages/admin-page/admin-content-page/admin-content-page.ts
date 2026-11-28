import { Component, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { DatePipe, isPlatformBrowser } from '@angular/common';
import { AdminService } from '../../../core/services/admin.service';
import { ContentRecord, ContentVersion } from '../../../core/models/admin';
import {
  BlockValue,
  CONTENT_BLOCKS,
  ContentBlock,
  markdownFields,
} from '../../../core/content/content-blocks';
import { PRIVACY_MARKDOWN, TERMS_MARKDOWN } from '../../../core/content/legal-defaults';
import { Shape } from '../../../shared/kit/shapes/shape';
import { adminErrorMessage } from '../admin-links';

type Item = Record<string, string | boolean>;

// The page each block shows on, for "Preview on the site"
const PAGE_URLS: Record<string, string> = {
  Homepage: '/',
  'About AI Law': '/about',
  Contacts: '/about',
  Announcement: '/',
  Legal: '/privacy',
};
const LEGAL_DEFAULTS: Record<string, string> = {
  'legal.privacy': PRIVACY_MARKDOWN,
  'legal.terms': TERMS_MARKDOWN,
};

// Content: the website's text. Each block is edited as a draft, previewed
// (here, or on the site itself), then published; the site shows its own
// text for every block nobody has published. Layouts and styles stay in code.
@Component({
  selector: 'app-admin-content-page',
  imports: [DatePipe, Shape],
  templateUrl: './admin-content-page.html',
  styleUrl: './admin-content-page.scss',
})
export class AdminContentPage {
  private readonly admin = inject(AdminService);

  protected readonly records = signal<Record<string, ContentRecord>>({});
  protected readonly loaded = signal(false);
  protected readonly openKey = signal<string | null>(null);
  // The value being edited (a copy until saved)
  protected readonly value = signal<BlockValue>('');
  protected readonly preview = signal<string | null>(null);
  protected readonly versions = signal<ContentVersion[] | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly busy = signal(false);

  // Blocks grouped by the page they show on
  protected readonly groups = computed(() => {
    const groups: { page: string; blocks: ContentBlock[] }[] = [];
    for (const block of CONTENT_BLOCKS) {
      let group = groups.find((g) => g.page === block.page);
      if (!group) groups.push((group = { page: block.page, blocks: [] }));
      group.blocks.push(block);
    }
    return groups;
  });

  protected readonly block = computed(
    () => CONTENT_BLOCKS.find((b) => b.key === this.openKey()) ?? null,
  );
  protected readonly record = computed(() => this.records()[this.openKey() ?? ''] ?? null);

  constructor() {
    if (isPlatformBrowser(inject(PLATFORM_ID))) this.load();
  }

  private async load(): Promise<void> {
    try {
      const list = await this.admin.contentBlocks();
      this.records.set(Object.fromEntries(list.map((r) => [r.key, r])));
      this.loaded.set(true);
    } catch (error) {
      this.error.set(adminErrorMessage(error));
    }
  }

  // What the list says about a block
  protected state(block: ContentBlock): 'site' | 'published' | 'draft' {
    const r = this.records()[block.key];
    if (r?.changed) return 'draft';
    return r?.published !== null && r?.published !== undefined ? 'published' : 'site';
  }

  protected open(block: ContentBlock): void {
    this.openKey.set(block.key);
    this.preview.set(null);
    this.versions.set(null);
    this.error.set(null);
    this.notice.set(null);
    const r = this.records()[block.key];
    const start = r?.draft ?? r?.published ?? LEGAL_DEFAULTS[block.key] ?? block.default;
    this.value.set(structuredClone(start) as BlockValue);
  }

  // ---------- Editing ----------

  protected setText(text: string): void {
    this.value.set(text);
  }

  protected items(): Item[] {
    const v = this.value();
    return Array.isArray(v) ? v : [];
  }

  protected fields(): Item {
    const v = this.value();
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  }

  protected setField(field: string, value: string | boolean): void {
    this.value.set({ ...this.fields(), [field]: value });
  }

  protected setItem(i: number, field: string, value: string): void {
    this.value.set(this.items().map((item, n) => (n === i ? { ...item, [field]: value } : item)));
  }

  protected addItem(): void {
    const empty = Object.fromEntries((this.block()?.fields ?? []).map((f) => [f.key, '']));
    this.value.set([...this.items(), empty]);
  }

  protected removeItem(i: number): void {
    this.value.set(this.items().filter((_, n) => n !== i));
  }

  protected moveItem(i: number, by: -1 | 1): void {
    const list = [...this.items()];
    const j = i + by;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    this.value.set(list);
  }

  protected str(value: unknown): string {
    return typeof value === 'string' ? value : '';
  }

  // ---------- Saving and publishing ----------

  private async change(run: () => Promise<ContentRecord>, done: string): Promise<boolean> {
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    try {
      const r = await run();
      this.records.update((all) => ({ ...all, [r.key]: r }));
      this.notice.set(done);
      return true;
    } catch (error) {
      this.error.set(adminErrorMessage(error));
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  protected saveDraft(): Promise<boolean> {
    const block = this.block()!;
    return this.change(
      () => this.admin.saveContentDraft(block.key, block.type, markdownFields(block), this.value()),
      'Draft saved. Visitors still see the published text.',
    );
  }

  protected async publish(): Promise<void> {
    const block = this.block()!;
    // What is on the screen is saved first, so what gets published is what you see
    if (!(await this.saveDraft())) return;
    if (!confirm(`Publish "${block.label}" on the website?`)) return;
    await this.change(
      () => this.admin.publishContent(block.key),
      'Published. Visitors see it within a minute; the text before is kept in Versions.',
    );
  }

  protected async unpublish(): Promise<void> {
    const block = this.block()!;
    if (!confirm(`Take "${block.label}" off the website? The site shows its own text again.`))
      return;
    await this.change(
      () => this.admin.unpublishContent(block.key),
      'The site shows its own text again. Your draft is kept.',
    );
  }

  protected async discard(): Promise<void> {
    const block = this.block()!;
    if (!confirm('Throw the draft away and go back to what the site shows?')) return;
    const done = await this.change(
      () => this.admin.discardContentDraft(block.key),
      'Draft discarded.',
    );
    if (done) this.open(block);
  }

  // Here, as the site would show it
  protected async showPreview(): Promise<void> {
    const block = this.block()!;
    this.error.set(null);
    try {
      const result = await this.admin.previewContent(
        block.type,
        markdownFields(block),
        this.value(),
      );
      this.preview.set(result.html ?? this.previewOf(result.value));
    } catch (error) {
      this.error.set(adminErrorMessage(error));
    }
  }

  // A list or fields block: each field, its Markdown as HTML
  private previewOf(value: unknown): string {
    const escape = (t: string) =>
      t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const one = (item: Item) =>
      (this.block()?.fields ?? [])
        .map((f) => {
          const html = item[f.key + 'Html'];
          const text = item[f.key];
          if (typeof html === 'string') return html;
          if (typeof text === 'boolean') return `<p><b>${f.label}:</b> ${text ? 'yes' : 'no'}</p>`;
          return text ? `<p><b>${f.label}:</b> ${escape(String(text))}</p>` : '';
        })
        .join('');
    return Array.isArray(value)
      ? value.map((item) => `<div class="preview-item">${one(item)}</div>`).join('')
      : typeof value === 'string'
        ? `<p>${escape(value)}</p>`
        : one(value as Item);
  }

  // On the site itself, with every draft in place (saved first)
  protected async previewOnSite(): Promise<void> {
    const block = this.block()!;
    if (!(await this.saveDraft())) return;
    const url = block.key === 'legal.terms' ? '/terms' : (PAGE_URLS[block.page] ?? '/');
    window.open(url + '?preview=content', '_blank', 'noopener');
  }

  // ---------- Versions ----------

  protected async showVersions(): Promise<void> {
    this.error.set(null);
    try {
      this.versions.set(await this.admin.contentVersions(this.openKey()!));
    } catch (error) {
      this.error.set(adminErrorMessage(error));
    }
  }

  protected async restore(v: ContentVersion): Promise<void> {
    const block = this.block()!;
    const done = await this.change(
      () => this.admin.restoreContent(block.key, v.id),
      'That version is now the draft: look at it, then publish it.',
    );
    if (done) this.open(block);
  }
}
