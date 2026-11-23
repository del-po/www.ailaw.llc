import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { authErrorMessage } from '../../../core/services/auth-errors';
import { Header } from '../../../shared/components/header/header';
import { Footer } from '../../../shared/components/footer/footer';
import { Shape } from '../../../shared/kit/shapes/shape';

@Component({
  selector: 'app-forgot-password-page',
  imports: [RouterLink, Header, Footer, Shape],
  templateUrl: './forgot-password-page.html',
  styleUrl: './forgot-password-page.scss',
})
export class ForgotPasswordPage {
  private readonly auth = inject(AuthService);

  protected readonly busy = signal(false);
  protected readonly sentTo = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  protected async submit(event: Event, email: string): Promise<void> {
    event.preventDefault();
    this.busy.set(true);
    this.error.set(null);

    try {
      await this.auth.sendPasswordReset(email.trim());
      this.sentTo.set(email.trim());
    } catch (error) {
      this.error.set(authErrorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
