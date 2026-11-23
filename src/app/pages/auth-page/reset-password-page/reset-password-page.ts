import { Component, afterNextRender, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { authErrorMessage } from '../../../core/services/auth-errors';
import { Header } from '../../../shared/components/header/header';
import { Footer } from '../../../shared/components/footer/footer';
import { Shape } from '../../../shared/kit/shapes/shape';
import { MIN_PASSWORD } from '../auth-utils';

// Opened from the link in the reset email (?oobCode=…)
type State = 'checking' | 'ready' | 'done' | 'invalid';

@Component({
  selector: 'app-reset-password-page',
  imports: [RouterLink, Header, Footer, Shape],
  templateUrl: './reset-password-page.html',
  styleUrl: './reset-password-page.scss',
})
export class ResetPasswordPage {
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);

  protected readonly minPassword = MIN_PASSWORD;
  protected readonly state = signal<State>('checking');
  protected readonly email = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  private code = '';

  constructor() {
    afterNextRender(() => this.checkLink());
  }

  private async checkLink(): Promise<void> {
    this.code = this.route.snapshot.queryParamMap.get('oobCode') ?? '';
    if (!this.code) {
      this.state.set('invalid');
      return;
    }

    try {
      this.email.set(await this.auth.checkResetCode(this.code));
      this.state.set('ready');
    } catch (error) {
      this.error.set(authErrorMessage(error));
      this.state.set('invalid');
    }
  }

  protected async submit(event: Event, password: string, repeat: string): Promise<void> {
    event.preventDefault();
    this.error.set(null);

    if (password !== repeat) {
      this.error.set("The two passwords don't match.");
      return;
    }

    this.busy.set(true);
    try {
      await this.auth.resetPassword(this.code, password);
      this.state.set('done');
    } catch (error) {
      this.error.set(authErrorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
