import { Component, computed, input } from '@angular/core';
import { ADMIN_SECTIONS } from '../admin-links';

// Placeholder for admin sections that don't have a backend yet
@Component({
  selector: 'app-admin-soon',
  templateUrl: './admin-soon.html',
  styleUrl: './admin-soon.scss',
})
export class AdminSoon {
  readonly link = input.required<string>();

  protected readonly section = computed(() => ADMIN_SECTIONS.find((s) => s.link === this.link()));
}
