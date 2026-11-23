import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PROFILE_SECTIONS } from '../profile-links';

// Placeholder for profile sections that don't have a backend yet
@Component({
  selector: 'app-coming-soon',
  imports: [RouterLink],
  templateUrl: './coming-soon.html',
  styleUrl: './coming-soon.scss',
})
export class ComingSoon {
  readonly link = input.required<string>();

  protected readonly section = computed(() => PROFILE_SECTIONS.find((s) => s.link === this.link()));
}
