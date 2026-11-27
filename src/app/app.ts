import { Component, inject } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from './core/services/auth.service';
import { ThemeService } from './core/services/theme.service';

// Pages a lawyer may still open: their Workspace, signing in and out, and the legal pages
const STAFF_PAGES =
  /^\/(workspace|login|forgot-password|reset-password|verify-email|auth\/action|privacy|terms)(\/|\?|#|$)/;

@Component({
  imports: [RouterOutlet],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  // Started here so the saved theme applies on every page, not only pages with the switch
  private readonly theme = inject(ThemeService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  constructor() {
    // A lawyer login works only in the Workspace: any other page sends them back there
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(async (e) => {
        await this.auth.whenReady();
        if (this.auth.isStaff() && !STAFF_PAGES.test(e.urlAfterRedirects)) {
          await this.router.navigateByUrl('/workspace', { replaceUrl: true });
        }
      });
  }
}
