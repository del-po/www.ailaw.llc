import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ALL_ADMIN_SECTIONS } from '../admin-links';

// Placeholder for admin sections that are still being built; the section
// is found by the route's own path (/admin/documents …)
@Component({
  selector: 'app-admin-soon',
  templateUrl: './admin-soon.html',
  styleUrl: './admin-soon.scss',
})
export class AdminSoon {
  private readonly path = inject(ActivatedRoute).snapshot.routeConfig?.path ?? '';

  protected readonly section = ALL_ADMIN_SECTIONS.find((s) => s.link === '/admin/' + this.path);
}
