import { Component, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { rxResource } from '@angular/core/rxjs-interop';
import { BlogService } from '../../../core/services/blog.service';

// Articles are written and published in Google Drive (Blog → Published);
// this page lists what is live on the site
const BLOG_FOLDER = 'https://drive.google.com/drive/folders/1ZhkBniXrv_si4AC6kVfKmPw4BhhszRHK';

@Component({
  selector: 'app-admin-blog-page',
  imports: [DatePipe, RouterLink],
  templateUrl: './admin-blog-page.html',
  styleUrl: './admin-blog-page.scss',
})
export class AdminBlogPage {
  private readonly blog = inject(BlogService);

  protected readonly folder = BLOG_FOLDER;
  protected readonly posts = rxResource({ stream: () => this.blog.getPosts() });
}
