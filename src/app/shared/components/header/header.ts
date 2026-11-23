import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { CartService } from '../../../core/services/cart.service';
import { Logo } from '../../kit/logo/logo';
import { Icon } from '../../kit/icon/icon';
import { Shape } from '../../kit/shapes/shape';
import { IconName } from '../../kit/icon/icons';

interface NavLink {
  label: string;
  link: string;
  icon: IconName;
}

@Component({
  selector: 'app-header',
  imports: [RouterLink, RouterLinkActive, Logo, Icon, Shape],
  templateUrl: './header.html',
  styleUrl: './header.scss',
  host: {
    '(document:click)': 'closeOnOutsideClick($event)',
    '(document:keydown.escape)': 'closeMenus()',
  },
})
export class Header {
  protected readonly mainLinks: NavLink[] = [
    { label: 'Services', link: '/services', icon: 'scales' },
    { label: 'Chat', link: '/chat', icon: 'chat' },
    { label: 'Blog', link: '/blog', icon: 'blog' },
  ];

  protected readonly extraLinks: NavLink[] = [
    { label: 'Cart', link: '/cart', icon: 'cart' },
    { label: 'Profile', link: '/profile', icon: 'user' },
  ];

  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly cartCount = inject(CartService).count;

  constructor() {
    // The menu shows "Admin" for admins, so the profile is loaded once after sign-in
    effect(() => {
      if (this.auth.user() && !this.auth.profile()) {
        this.auth.loadProfile().catch(() => undefined);
      }
    });
  }

  // "Gocha Okreshidze" → "GO"; falls back to the first letter of the email
  protected readonly initials = computed(() => {
    const user = this.auth.user();
    const words = (user?.displayName ?? '').split(/\s+/).filter(Boolean);
    const letters = words.length ? words.slice(0, 2).map((w) => w[0]) : [user?.email?.[0] ?? '?'];
    return letters.join('').toUpperCase();
  });

  // ---------- Dropdowns: burger (site links) and account ----------

  private readonly dropdown = viewChild<ElementRef<HTMLElement>>('dropdown');
  private readonly account = viewChild<ElementRef<HTMLElement>>('account');
  protected readonly menuOpen = signal(false);
  protected readonly accountOpen = signal(false);

  protected toggleMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.accountOpen.set(false);
    this.menuOpen.update((open) => !open);
  }

  protected toggleAccount(event: MouseEvent): void {
    event.stopPropagation();
    this.menuOpen.set(false);
    this.accountOpen.update((open) => !open);
  }

  protected closeMenus(): void {
    this.menuOpen.set(false);
    this.accountOpen.set(false);
  }

  protected closeOnOutsideClick(event: MouseEvent): void {
    const target = event.target as Node;
    if (this.menuOpen() && !this.dropdown()?.nativeElement.contains(target)) {
      this.menuOpen.set(false);
    }
    if (this.accountOpen() && !this.account()?.nativeElement.contains(target)) {
      this.accountOpen.set(false);
    }
  }

  protected async logOut(): Promise<void> {
    this.closeMenus();
    await this.auth.signOut();
    await this.router.navigateByUrl('/');
  }
}
