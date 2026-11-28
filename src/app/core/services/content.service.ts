import { PLATFORM_ID, Service, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { BLOCKS_BY_KEY, BlockValue } from '../content/content-blocks';
import { AuthService } from './auth.service';
import { DOORS, DoorResult } from './doors';

// A published block as the backend sends it: Markdown also as HTML
export interface PublishedBlock {
  type: string;
  value: BlockValue;
  html?: string;
  toc?: { id: string; title: string }[];
  publishedAt: string;
}

type Item = Record<string, string | boolean>;

// The last published text, so a returning visitor sees it at once
const CACHE_KEY = 'ailaw.content';
// Set while an admin previews the drafts on the site
const PREVIEW_KEY = 'ailaw.content-preview';

// The website's editable text (Admin Panel → Content). Pages ask for a
// block by its key and get what is published, or the text the website was
// written with (core/content/content-blocks.ts). An admin who opens the
// site with ?preview=content sees the drafts instead, until they leave the
// preview.
@Service()
export class ContentService {
  private readonly auth = inject(AuthService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private readonly blocks = signal<Record<string, PublishedBlock>>({});
  readonly previewing = signal(false);

  constructor() {
    if (!this.isBrowser) return;
    try {
      this.blocks.set(JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'));
    } catch {
      // Storage blocked or an old copy: the site's own text shows until the fresh one arrives
    }
    const asked = new URLSearchParams(location.search).get('preview') === 'content';
    if (asked) sessionStorage.setItem(PREVIEW_KEY, '1');
    this.load(asked || sessionStorage.getItem(PREVIEW_KEY) === '1');
  }

  // ---------- Reading ----------

  // The published block, or null while the site shows its own text
  published(key: string): PublishedBlock | null {
    return this.blocks()[key] ?? null;
  }

  // A text block, or one field of a fields block
  text(key: string, field?: string): string {
    const value = this.value(key);
    if (field) return String((value as Item | undefined)?.[field] ?? '');
    return typeof value === 'string' ? value : '';
  }

  // A list block's items
  items(key: string): Item[] {
    const value = this.value(key);
    return Array.isArray(value) ? value : [];
  }

  // A fields block's fields
  fields(key: string): Item {
    const value = this.value(key);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  private value(key: string): BlockValue | undefined {
    return this.blocks()[key]?.value ?? BLOCKS_BY_KEY[key]?.default;
  }

  // ---------- Loading ----------

  private async load(preview: boolean): Promise<void> {
    try {
      if (preview && (await this.loadDrafts())) return;
      const res = await fetch(`${DOORS.client}?action=content:published`);
      const result = (await res.json()) as DoorResult<{ blocks: Record<string, PublishedBlock> }>;
      if (!result.ok) return;
      this.blocks.set(result.data.blocks);
      localStorage.setItem(CACHE_KEY, JSON.stringify(result.data.blocks));
    } catch {
      // Offline, or storage blocked: the text already shown stays
    }
  }

  // The drafts, through the admin door: only an admin gets them
  private async loadDrafts(): Promise<boolean> {
    await this.auth.whenReady();
    if (!this.auth.user()) return false;
    try {
      const res = await fetch(DOORS.admin, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'content:drafts',
          idToken: await this.auth.idToken(),
          data: {},
        }),
      });
      const result = (await res.json()) as DoorResult<{ blocks: Record<string, PublishedBlock> }>;
      if (!result.ok) return false;
      this.blocks.set(result.data.blocks);
      this.previewing.set(true);
      return true;
    } catch {
      return false;
    }
  }

  // Back to what visitors see
  exitPreview(): void {
    sessionStorage.removeItem(PREVIEW_KEY);
    this.previewing.set(false);
    this.load(false);
  }
}
