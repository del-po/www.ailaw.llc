import { Component, afterNextRender, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AdminService } from '../../../core/services/admin.service';
import { AdminPost, AdminPostRow } from '../../../core/models/admin';
import { Shape } from '../../../shared/kit/shapes/shape';
import { adminErrorMessage, readUpload } from '../admin-links';

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
        status: field('status') === 'published' ? 'published' : 'draft',
      });
      if (this.cover) await this.admin.uploadCover(slug, await readUpload(this.cover));
      this.open(await this.admin.getPost(slug));
      this.notice.set(
        this.editing()?.status === 'published' ? 'Saved and published.' : 'Saved as a draft.',
      );
      await this.load();
    } catch (error) {
      this.error.set(adminErrorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

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
    this.editing.set(post);
  }
}
