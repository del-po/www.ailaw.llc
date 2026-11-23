import { Component, afterNextRender, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { authErrorMessage } from '../../../core/services/auth-errors';
import { Header } from '../../../shared/components/header/header';
import { Footer } from '../../../shared/components/footer/footer';
import { PROFILE_SECTIONS } from '../profile-links';

// Frame for every profile page: menu on the left, the section on the right.
// Loads the Users row once, for all sections.
@Component({
  selector: 'app-profile-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Header, Footer],
  templateUrl: './profile-layout.html',
  styleUrl: './profile-layout.scss',
})
export class ProfileLayout {
  private readonly auth = inject(AuthService);

  protected readonly sections = PROFILE_SECTIONS;
  protected readonly loadError = signal<string | null>(null);

  constructor() {
    afterNextRender(() => this.load());
  }

  protected async load(): Promise<void> {
    this.loadError.set(null);
    try {
      await this.auth.loadProfile();
    } catch (error) {
      this.loadError.set(authErrorMessage(error));
    }
  }
}
