import { Service, inject, signal, computed, effect, PLATFORM_ID, DOCUMENT } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'theme';

@Service()
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly theme = signal<Theme>(this.readSaved());
  readonly isDark = computed(() => this.theme() === 'dark');

  constructor() {
    // Apply the theme to <body> and remember it whenever it changes
    effect(() => {
      const theme = this.theme();
      this.document.body.classList.toggle('dark', theme === 'dark');

      if (this.isBrowser) {
        try {
          localStorage.setItem(STORAGE_KEY, theme);
        } catch {
          // Storage unavailable (e.g. private mode): theme still works for this visit
        }
      }
    });
  }

  toggle(): void {
    this.theme.update((t) => (t === 'dark' ? 'light' : 'dark'));
  }

  set(theme: Theme): void {
    this.theme.set(theme);
  }

  // Server has no storage, so it always renders light
  private readSaved(): Theme {
    if (!this.isBrowser) return 'light';
    try {
      return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  }
}
