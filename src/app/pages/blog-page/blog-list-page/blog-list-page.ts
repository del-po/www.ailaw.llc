import { Component, computed, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { rxResource, toSignal } from '@angular/core/rxjs-interop';
import { BlogService } from '../../../core/services/blog.service';
import { BlogPostSummary } from '../../../core/models/blog';
import { Header } from '../../../shared/components/header/header';
import { Footer } from '../../../shared/components/footer/footer';

const ALL = 'All';

@Component({
  selector: 'app-blog-list-page',
  imports: [RouterLink, DatePipe, Header, Footer],
  templateUrl: './blog-list-page.html',
  styleUrl: './blog-list-page.scss',
})
export class BlogListPage {
  private readonly blog = inject(BlogService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly posts = rxResource({ stream: () => this.blog.getPosts() });

  // Filters live in the address (?category=…&q=…), so every filtered view has its own link
  private readonly query = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  protected readonly category = computed(() => this.query().get('category') ?? ALL);
  protected readonly search = computed(() => this.query().get('q') ?? '');
  protected readonly filtering = computed(() => this.category() !== ALL || !!this.search());

  protected readonly categories = computed(() => {
    const names = (this.posts.value() ?? []).map((p) => p.category);
    return [ALL, ...new Set(names)];
  });

  // Featured post (or the newest) leads the page when no filter is on
  protected readonly featured = computed<BlogPostSummary | null>(() => {
    const posts = this.posts.value() ?? [];
    if (this.filtering() || !posts.length) return null;
    return posts.find((p) => p.featured) ?? posts[0];
  });

  protected readonly list = computed(() => {
    const posts = this.posts.value() ?? [];
    const category = this.category();
    const words = this.search().toLowerCase().split(/\s+/).filter(Boolean);
    const featured = this.featured();

    return posts.filter((post) => {
      if (post === featured) return false;
      if (category !== ALL && post.category !== category) return false;
      if (!words.length) return true;

      const haystack = [post.title, post.deck, post.tags.join(' '), post.searchText]
        .join(' ')
        .toLowerCase();
      return words.every((word) => haystack.includes(word));
    });
  });

  protected setCategory(name: string): void {
    this.updateQuery({ category: name === ALL ? null : name });
  }

  protected setSearch(value: string): void {
    this.updateQuery({ q: value.trim() || null });
  }

  private updateQuery(params: Record<string, string | null>): void {
    this.router.navigate([], {
      queryParams: params,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
