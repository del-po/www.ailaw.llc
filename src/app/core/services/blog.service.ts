import { Service, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { BlogPost, BlogPostSummary } from '../models/blog';

// Google Apps Script web app that serves posts from the Drive "Published" folder
const BLOG_API =
  'https://script.google.com/macros/s/AKfycbyBqQrLJhglsXOcbzRjUkpk8MSLvM2ql9dT_oLH1nlwAF2j73wu4c5FEfcocqYWQLBypA/exec';

type ApiResult<T> = T | { error: string };

@Service()
export class BlogService {
  private readonly http = inject(HttpClient);

  getPosts(): Observable<BlogPostSummary[]> {
    return this.http
      .get<ApiResult<BlogPostSummary[]>>(BLOG_API, { params: { action: 'getPosts' } })
      .pipe(map((result) => unwrap(result)));
  }

  getPost(slug: string): Observable<BlogPost> {
    return this.http
      .get<ApiResult<BlogPost>>(BLOG_API, { params: { action: 'getPost', slug } })
      .pipe(map((result) => unwrap(result)));
  }
}

// The API reports problems as { error } with a 200 status, so turn those into real errors
function unwrap<T>(result: ApiResult<T>): T {
  if (result && typeof result === 'object' && 'error' in result) {
    throw new Error(result.error);
  }
  return result as T;
}
