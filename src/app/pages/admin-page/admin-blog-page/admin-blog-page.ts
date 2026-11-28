import { Component, afterNextRender, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AdminService } from '../../../core/services/admin.service';
import { AdminPost, AdminPostRow, PostStatus } from '../../../core/models/admin';
import { Shape } from '../../../shared/kit/shapes/shape';
import { readUpload } from '../../../core/services/read-upload';
import { adminErrorMessage } from '../admin-links';

const STATUSES: PostStatus[] = ['draft', 'scheduled', 'published'];

// An ISO time → "2026-12-05T09:00" in Tbilisi (UTC+4, no summer time), or ''
function tbilisiTime(iso: string): string {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? '' : new Date(time + 4 * 3600 * 1000).toISOString().slice(0, 16);
}

// A post nobody has saved yet
const BLANK: AdminPost = {
  slug: '',
  title: '',
  deck: '',
  body: '',
  author: 'AI Law Editorial Team',
  category: '',
  tags: '',
  featured: false,
  status: 'draft',
  cover: '',
  publishedAt: '',
  updatedAt: '',
};

@Component({
  selector: 'app-admin-blog-page',
  imports: [DatePipe, RouterLink, Shape],
  templateUrl: './admin-blog-page.html',
  styleUrl: './admin-blog-page.scss',
})
export class AdminBlogPage {
  private readonly admin = inject(AdminService);

  protected readonly posts = signal<AdminPostRow[] | null>(null);
  protected readonly editing = signal<AdminPost | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  // The chosen cover, shown before it is uploaded
  protected readonly preview = signal<string | null>(null);
  // The text as the site will show it, after "Preview"
  protected readonly bodyPreview = signal<string | null>(null);
  private cover: File | null = null;

  constructor() {
    afterNextRender(() => this.load());
  }

  protected async load(): Promise<void> {
    this.error.set(null);
    try {
      this.posts.set(await this.admin.listPosts());
    } catch (error) {
      this.error.set(adminErrorMessage(error));
    }
  }

  protected newPost(): void {
    this.open({ ...BLANK });
  }

  protected async edit(row: AdminPostRow): Promise<void> {
    this.error.set(null);
    try {
      this.open(await this.admin.getPost(row.slug));
    } catch (error) {
      this.error.set(adminErrorMessage(error));
    }
  }

  protected pickCover(input: HTMLInputElement): void {
    this.cover = input.files?.[0] ?? null;
    const old = this.preview();
    if (old) URL.revokeObjectURL(old);
    this.preview.set(this.cover ? URL.createObjectURL(this.cover) : null);
  }

  protected async save(form: HTMLFormElement, event: Event): Promise<void> {
    event.preventDefault();
    const post = this.editing();
    if (!post) return;
    const field = (name: string) =>
      (form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement).value;

    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    try {
      // The address stays the same once a post exists, so links keep working
      const { slug } = await this.admin.savePost({
        slug: post.slug || field('slug'),
        title: field('title'),
        deck: field('deck'),
        body: field('body'),
        author: field('author'),
        category: field('category'),
        tags: field('tags'),
        featured: (form.elements.namedItem('featured') as HTMLInputElement).checked,
        status: STATUSES.includes(field('status') as PostStatus)
          ? (field('status') as PostStatus)
          : 'draft',
        publishAt: field('publishAt'),
      });
      if (this.cover) await this.admin.uploadCover(slug, await readUpload(this.cover));
      this.open(await this.admin.getPost(slug));
      const saved = this.editing();
      this.notice.set(
        saved?.status === 'published'
          ? 'Saved and published.'
          : saved?.status === 'scheduled'
            ? `Saved. It appears on the site on ${tbilisiTime(saved.publishedAt).replace('T', ' at ')}.`
            : 'Saved as a draft.',
      );
      await this.load();
    } catch (error) {
      this.error.set(adminErrorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected async showPreview(body: string): Promise<void> {
    this.error.set(null);
    try {
      this.bodyPreview.set((await this.admin.previewPost(body)).html);
    } catch (error) {
      this.error.set(adminErrorMessage(error));
    }
  }

  // For the date and time field: the scheduled time in Tbilisi
  protected readonly tbilisiTime = tbilisiTime;

  protected async remove(post: AdminPost): Promise<void> {
    if (!confirm(`Delete "${post.title}"? This can't be undone.`)) return;
    this.busy.set(true);
    try {
      await this.admin.deletePost(post.slug);
      this.close();
      await this.load();
    } catch (error) {
      this.error.set(adminErrorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected close(): void {
    this.editing.set(null);
    this.pickCover({ files: null } as HTMLInputElement);
  }

  private open(post: AdminPost): void {
    this.pickCover({ files: null } as HTMLInputElement);
    this.bodyPreview.set(null);
    this.editing.set(post);
  }
}
