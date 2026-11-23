import { Component, afterNextRender, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { authErrorMessage } from '../../../core/services/auth-errors';
import { Header } from '../../../shared/components/header/header';
import { Footer } from '../../../shared/components/footer/footer';
import { Shape } from '../../../shared/kit/shapes/shape';

const RESEND_WAIT = 60; // seconds between resends

// Two ways in: right after registering ("check your inbox"),
// or from the link in the email (?oobCode=…), which confirms the address
type State = 'waiting' | 'checking' | 'verified' | 'failed';

@Component({
  selector: 'app-verify-email-page',
  imports: [RouterLink, Header, Footer, Shape],
  templateUrl: './verify-email-page.html',
  styleUrl: './verify-email-page.scss',
})
export class VerifyEmailPage {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly state = signal<State>('waiting');
  protected readonly busy = signal(false);
  protected readonly message = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly resendIn = signal(0);

  constructor() {
    afterNextRender(() => {
      const code = this.route.snapshot.queryParamMap.get('oobCode');
      if (code) this.verify(code);
    });
  }

  private async verify(code: string): Promise<void> {
    this.state.set('checking');
    try {
      await this.auth.applyVerification(code);
      this.state.set('verified');
    } catch (error) {
      this.error.set(authErrorMessage(error));
      this.state.set('failed');
    }
  }

  protected async resend(): Promise<void> {
    await this.run(async () => {
      await this.auth.resendVerification();
      this.message.set('A new link is on its way. Check your inbox and spam folder.');
      this.startCountdown();
    });
  }

  // "I've confirmed": asks Firebase whether the link was clicked, e.g. on a phone
  protected async check(): Promise<void> {
    await this.run(async () => {
      if (await this.auth.refreshUser()) {
        await this.router.navigateByUrl('/profile');
      } else {
        this.message.set('Not confirmed yet. Open the link in the email, then try again.');
      }
    });
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    this.message.set(null);
    try {
      await action();
    } catch (error) {
      this.error.set(authErrorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  private startCountdown(): void {
    this.resendIn.set(RESEND_WAIT);
    const timer = setInterval(() => {
      this.resendIn.update((s) => s - 1);
      if (this.resendIn() <= 0) clearInterval(timer);
    }, 1000);
  }
}
