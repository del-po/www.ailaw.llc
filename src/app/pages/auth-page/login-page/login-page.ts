import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { authErrorMessage } from '../../../core/services/auth-errors';
import { Header } from '../../../shared/components/header/header';
import { Footer } from '../../../shared/components/footer/footer';
import { Shape } from '../../../shared/kit/shapes/shape';
import { Icon } from '../../../shared/kit/icon/icon';
import { safeReturnUrl } from '../auth-utils';

@Component({
  selector: 'app-login-page',
  imports: [RouterLink, Header, Footer, Shape, Icon],
  templateUrl: './login-page.html',
  styleUrl: './login-page.scss',
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected submit(event: Event, email: string, password: string): void {
    event.preventDefault();
    this.run(() => this.auth.signIn(email.trim(), password));
  }

  protected google(): void {
    this.run(() => this.auth.signInWithGoogle());
  }

  private async run(signIn: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);

    try {
      await signIn();
      // Staff always start in their Workspace
      const next = this.auth.isStaff()
        ? '/workspace'
        : this.auth.needsVerification()
          ? '/verify-email'
          : safeReturnUrl(this.route.snapshot.queryParamMap.get('returnUrl'));
      await this.router.navigateByUrl(next);
    } catch (error) {
      this.error.set(authErrorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
