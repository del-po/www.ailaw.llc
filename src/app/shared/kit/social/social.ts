import { Component, computed, inject, input } from '@angular/core';
import { ContentService } from '../../../core/services/content.service';
import { Icon } from '../icon/icon';
import { Shape } from '../shapes/shape';
import { SOCIAL_LINKS, SocialLink, SocialName } from './social-links';

@Component({
  selector: 'app-social',
  imports: [Icon, Shape],
  templateUrl: './social.html',
  styleUrl: './social.scss',
})
export class Social {
  private readonly content = inject(ContentService);

  // Which networks to show, in this order. Defaults to all of them.
  readonly networks = input<SocialName[]>(Object.keys(SOCIAL_LINKS) as SocialName[]);

  // The links as published in Admin Panel → Content (site.social); a network
  // whose link was emptied there isn't shown
  protected readonly links = computed<SocialLink[]>(() => {
    const published = this.content.published('site.social')
      ? this.content.fields('site.social')
      : null;
    return this.networks()
      .map((name) => ({
        ...SOCIAL_LINKS[name],
        url: published ? String(published[name] ?? '').trim() : SOCIAL_LINKS[name].url,
      }))
      .filter((link) => !!link.url);
  });
}
