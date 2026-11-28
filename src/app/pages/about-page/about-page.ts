import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ContentService } from '../../core/services/content.service';
import { Header } from '../../shared/components/header/header';
import { Footer } from '../../shared/components/footer/footer';
import { Shape } from '../../shared/kit/shapes/shape';
import { Social } from '../../shared/kit/social/social';

// About AI Law (also the page the QR card leads to). Its text is edited in
// Admin Panel → Content; a block nobody has published shows the text below
// and in content-blocks.ts.
@Component({
  selector: 'app-about-page',
  imports: [RouterLink, Header, Footer, Shape, Social],
  templateUrl: './about-page.html',
  styleUrl: './about-page.scss',
})
export class AboutPage {
  protected readonly content = inject(ContentService);

  protected readonly principles = computed(() =>
    this.content.items('about.principles').map((p) => ({
      title: String(p['title'] ?? ''),
      text: String(p['text'] ?? ''),
    })),
  );

  // Only once published: until then the page has no FAQ or contacts section
  protected readonly faq = computed(() =>
    (this.content.published('about.faq') ? this.content.items('about.faq') : []).map((q) => ({
      question: String(q['question'] ?? ''),
      answerHtml: String(q['answerHtml'] ?? ''),
    })),
  );

  protected readonly contacts = computed(() => {
    if (!this.content.published('site.contacts')) return null;
    const c = this.content.fields('site.contacts');
    const text = (k: string) => String(c[k] ?? '').trim();
    return {
      email: text('email'),
      phone: text('phone'),
      address: text('address'),
      hours: text('hours'),
      telegram: text('telegram'),
      whatsapp: text('whatsapp'),
    };
  });

  // "(+995) 591 893 893" → "tel:+995591893893"
  protected tel(phone: string): string {
    return 'tel:' + phone.replace(/[^\d+]/g, '');
  }
}
