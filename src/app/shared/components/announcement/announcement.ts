import { Component, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ContentService } from '../../../core/services/content.service';

// Closed announcements, by when they were published: a new one shows again
const CLOSED_KEY = 'ailaw.announcement-closed';

// The announcement bar (Admin Panel → Content → site.announcement): a small
// card at the bottom of every page while it is switched on, which visitors
// can close. While an admin previews drafts, it also says so.
@Component({
  selector: 'app-announcement',
  templateUrl: './announcement.html',
  styleUrl: './announcement.scss',
})
export class Announcement {
  protected readonly content = inject(ContentService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private readonly closedAt = signal(this.read());

  protected readonly message = computed(() => {
    const block = this.content.published('site.announcement');
    if (!this.isBrowser || !block) return null;
    const fields = this.content.fields('site.announcement');
    if (fields['active'] !== true || !fields['textHtml']) return null;
    if (this.closedAt() === block.publishedAt && !this.content.previewing()) return null;
    return { html: String(fields['textHtml']), publishedAt: block.publishedAt };
  });

  protected close(publishedAt: string): void {
    this.closedAt.set(publishedAt);
    try {
      localStorage.setItem(CLOSED_KEY, publishedAt);
    } catch {
      // Storage blocked: closed for this visit only
    }
  }

  private read(): string {
    try {
      return this.isBrowser ? localStorage.getItem(CLOSED_KEY) || '' : '';
    } catch {
      return '';
    }
  }
}
