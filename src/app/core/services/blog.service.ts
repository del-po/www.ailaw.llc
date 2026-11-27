import { Service, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { BlogPost, BlogPostSummary } from '../models/blog';
import { DOORS, DoorResult } from './doors';

@Service()
export class BlogService {
  private readonly http = inject(HttpClient);

  getPosts(): Observable<BlogPostSummary[]> {
    return this.http
      .get<DoorResult<BlogPostSummary[]>>(DOORS.client, { params: { action: 'getPosts' } })
      .pipe(map((result) => unwrap(result)));
  }

  getPost(slug: string): Observable<BlogPost> {
    return this.http
      .get<DoorResult<BlogPost>>(DOORS.client, { params: { action: 'getPost', slug } })
      .pipe(map((result) => unwrap(result)));
  }
}

// Problems come back as { ok: false, error } with a 200 status: turn them into real errors
function unwrap<T>(result: DoorResult<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
