import { Component, computed, effect, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { rxResource, toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { BlogService } from '../../../core/services/blog.service';
import { Header } from '../../../shared/components/header/header';
import { Footer } from '../../../shared/components/footer/footer';
import { Icon } from '../../../shared/kit/icon/icon';

const SITE_URL = 'https://ailaw.llc';

@Component({
  selector: 'app-blog-post-page',
  imports: [RouterLink, DatePipe, Header, Footer, Icon],
  templateUrl: './blog-post-page.html',
  styleUrl: './blog-post-page.scss',
})
export class BlogPostPage {
  private readonly blog = inject(BlogService);
  private readonly route = inject(ActivatedRoute);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);

  private readonly slug = toSignal(this.route.paramMap.pipe(map((p) => p.get('slug') ?? '')), {
    initialValue: this.route.snapshot.paramMap.get('slug') ?? '',
  });

  protected readonly post = rxResource({
    params: () => this.slug(),
    stream: ({ params }) => this.blog.getPost(params),
  });

  // ---------- Sharing ----------

  protected readonly url = computed(() => `${SITE_URL}/blog/${this.slug()}`);

  protected readonly shareLinks = computed(() => {
    const url = encodeURIComponent(this.url());
    const text = encodeURIComponent(this.post.value()?.title ?? '');
    return [
      {
        icon: 'facebook' as const,
        label: 'Facebook',
        href: `https://www.facebook.com/sharer/sharer.php?u=${url}`,
      },
      {
        icon: 'linkedin' as const,
        label: 'LinkedIn',
        href: `https://www.linkedin.com/sharing/share-offsite/?url=${url}`,
      },
      { icon: 'x' as const, label: 'X', href: `https://x.com/intent/post?url=${url}&text=${text}` },
      {
        icon: 'telegram' as const,
        label: 'Telegram',
        href: `https://t.me/share/url?url=${url}&text=${text}`,
      },
    ];
  });

  protected readonly copied = signal(false);

  protected async copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.url());
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    } catch {
      // Clipboard blocked by the browser: nothing to copy to
    }
  }

  constructor() {
    // Browser tab title and search-engine description follow the article
    effect(() => {
      const post = this.post.value();
      if (!post) return;
      this.title.setTitle(`${post.title} | AI Law`);
      this.meta.updateTag({
        name: 'description',
        content: post.deck || post.searchText.slice(0, 155),
      });
    });
  }
}
