import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { authErrorMessage } from '../../../core/services/auth-errors';
import { Header } from '../../../shared/components/header/header';
import { Footer } from '../../../shared/components/footer/footer';
import { Shape } from '../../../shared/kit/shapes/shape';
import { Icon } from '../../../shared/kit/icon/icon';
import { MIN_PASSWORD } from '../auth-utils';

@Component({
  selector: 'app-register-page',
  imports: [RouterLink, Header, Footer, Shape, Icon],
  templateUrl: './register-page.html',
  styleUrl: './register-page.scss',
})
export class RegisterPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly minPassword = MIN_PASSWORD;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected submit(event: Event, name: string, email: string, password: string): void {
    event.preventDefault();
    this.run(() => this.auth.register(name.trim(), email.trim(), password));
  }

  protected google(): void {
    this.run(() => this.auth.signInWithGoogle());
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);

    try {
      await action();
      // "Continue with Google" by an approved lawyer goes to their Workspace
      const next = this.auth.isStaff()
        ? '/workspace'
        : this.auth.needsVerification()
          ? '/verify-email'
          : '/profile';
      await this.router.navigateByUrl(next);
    } catch (error) {
      this.error.set(authErrorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
