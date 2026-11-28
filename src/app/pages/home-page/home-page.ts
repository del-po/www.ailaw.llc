import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ContentService } from '../../core/services/content.service';
import { ThemeService } from '../../core/services/theme.service';
import { IconName } from '../../shared/kit/icon/icons';
import { ThemeSwitch } from '../../shared/components/theme-switch/theme-switch';
import { Header } from '../../shared/components/header/header';
import { Social } from '../../shared/kit/social/social';
import { QrCard } from '../../shared/kit/qr-card/qr-card';

interface NavLink {
  label: string;
  link: string;
  icon?: IconName;
}

interface Slide {
  title: string;
  tag: string;
  text: string;
  link: string;
  cta: string;
}

// AI Law registered 21/08/2020 14:22:49, Tbilisi time (UTC+4, no daylight saving)
const REGISTERED = { y: 2020, mo: 8, d: 21, h: 14, mi: 22, s: 49 };
const TBILISI_OFFSET = 4 * 60 * 60 * 1000;

@Component({
  selector: 'app-home-page',
  imports: [RouterLink, Header, Social, QrCard, ThemeSwitch],
  templateUrl: './home-page.html',
  styleUrl: './home-page.scss',
})
export class HomePage {
  private readonly theme = inject(ThemeService);
  protected readonly content = inject(ContentService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  // ---------- Theme images ----------

  protected readonly background = computed(() =>
    this.theme.isDark()
      ? 'images/home-img/background-dark.webp'
      : 'images/home-img/background-light.webp',
  );

  protected readonly robot = computed(() =>
    this.theme.isDark() ? 'images/home-img/robot-dark.webp' : 'images/home-img/robot-light.webp',
  );

  // ---------- Side menu ----------
  // (top links, cart, account and burger live in the shared header)

  protected readonly sideLinks: NavLink[] = [
    { label: 'Services', link: '/services', icon: 'scales' },
    { label: 'Chat', link: '/chat', icon: 'chat' },
  ];

  // Side menu: hovered item is highlighted, otherwise the selected one
  protected readonly selectedSide = signal(0);
  protected readonly hoveredSide = signal<number | null>(null);
  protected readonly activeSide = computed(() => this.hoveredSide() ?? this.selectedSide());

  // ---------- Intro slides ----------

  // Their texts are edited in Admin Panel → Content (home.slides); the links stay here
  private readonly slideLinks = ['/chat', '/services', '/services'];
  protected readonly slides = computed<Slide[]>(() =>
    this.content.items('home.slides').map((item, i) => ({
      title: String(item['title'] ?? ''),
      tag: String(item['tag'] ?? ''),
      text: String(item['text'] ?? ''),
      cta: String(item['cta'] ?? ''),
      link: this.slideLinks[i] ?? '/services',
    })),
  );

  protected readonly currentSlide = signal(0);
  protected readonly slide = computed(() => this.slides()[this.currentSlide()] ?? this.slides()[0]);

  protected showSlide(index: number): void {
    this.currentSlide.set((index + this.slides().length) % this.slides().length);
  }

  // Fired when the active progress segment finishes filling
  protected nextSlide(): void {
    this.showSlide(this.currentSlide() + 1);
  }

  // ---------- Chat card ----------

  private readonly promo = viewChild.required<ElementRef<HTMLElement>>('promo');
  protected readonly promoViewBox = signal('0 0 0 0');
  protected readonly promoOutline = signal('');
  protected readonly promoAccent = signal('');

  protected send(event: Event, input: HTMLTextAreaElement): void {
    event.preventDefault();
    const question = input.value.trim();

    if (!question) {
      input.focus();
      return;
    }
    this.router.navigate(['/chat'], { queryParams: { q: question } });
  }

  // Enter sends, Shift+Enter makes a new line
  protected onInputKeydown(event: KeyboardEvent, input: HTMLTextAreaElement): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      this.send(event, input);
    }
  }

  // Outline follows the cut corners at any card size
  private drawPromoFrame(): void {
    const { width: w, height: h } = this.promo().nativeElement.getBoundingClientRect();
    const c = 16; // corner cut
    const i = 1; // keeps the line 1px inside the edge so it's never clipped

    this.promoViewBox.set(`0 0 ${w} ${h}`);
    this.promoOutline.set(
      `M${i},${i} H${w - c - i} L${w - i},${c + i} V${h - i} H${c + i} L${i},${h - c - i} Z`,
    );
    this.promoAccent.set(`M${w - c - 1},0 L${w},${c + 1}`);
  }

  // ---------- Time since registration ----------

  protected readonly ageYears = signal(0);
  protected readonly ageMonths = signal('00');
  protected readonly ageDays = signal('00');
  protected readonly ageTime = signal('00:00:00');

  private tick(): void {
    const pad = (n: number) => String(n).padStart(2, '0');
    const now = new Date(Date.now() + TBILISI_OFFSET);
    const r = REGISTERED;

    let y = now.getUTCFullYear() - r.y;
    let mo = now.getUTCMonth() + 1 - r.mo;
    let d = now.getUTCDate() - r.d;
    let h = now.getUTCHours() - r.h;
    let mi = now.getUTCMinutes() - r.mi;
    let s = now.getUTCSeconds() - r.s;

    // Borrow from the next unit up when a value goes below zero
    if (s < 0) {
      s += 60;
      mi--;
    }
    if (mi < 0) {
      mi += 60;
      h--;
    }
    if (h < 0) {
      h += 24;
      d--;
    }
    if (d < 0) {
      // Days in the month before the current one
      d += new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).getUTCDate();
      mo--;
    }
    if (mo < 0) {
      mo += 12;
      y--;
    }

    this.ageYears.set(y);
    this.ageMonths.set(pad(mo));
    this.ageDays.set(pad(d));
    this.ageTime.set(`${pad(h)}:${pad(mi)}:${pad(s)}`);
  }

  constructor() {
    this.tick();

    // Browser-only work: timers and size observers never run on the server
    afterNextRender(() => {
      const timer = setInterval(() => this.tick(), 1000);

      const observer = new ResizeObserver(() => this.drawPromoFrame());
      observer.observe(this.promo().nativeElement);

      this.destroyRef.onDestroy(() => {
        clearInterval(timer);
        observer.disconnect();
      });
    });
  }
}
