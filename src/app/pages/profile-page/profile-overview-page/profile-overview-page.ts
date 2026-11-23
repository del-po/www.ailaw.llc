import { Component, computed, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { Shape } from '../../../shared/kit/shapes/shape';
import { PROFILE_SECTIONS } from '../profile-links';

const PROVIDER_NAMES: Record<string, string> = {
  password: 'Email and password',
  'google.com': 'Google',
};

@Component({
  selector: 'app-profile-overview-page',
  imports: [RouterLink, DatePipe, Shape],
  templateUrl: './profile-overview-page.html',
  styleUrl: './profile-overview-page.scss',
})
export class ProfileOverviewPage {
  protected readonly auth = inject(AuthService);

  // Every section except this one, as shortcut tiles
  protected readonly shortcuts = PROFILE_SECTIONS.slice(1);

  protected readonly firstName = computed(() => {
    const profile = this.auth.profile();
    return profile?.FirstName || profile?.DisplayName.split(' ')[0] || '';
  });

  protected readonly signInMethods = computed(() =>
    (this.auth.profile()?.Providers ?? '')
      .split(',')
      .filter(Boolean)
      .map((id) => PROVIDER_NAMES[id] ?? id)
      .join(', '),
  );
}
