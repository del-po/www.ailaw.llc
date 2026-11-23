import { Component, computed, input } from '@angular/core';
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
  // Which networks to show, in this order. Defaults to all of them.
  readonly networks = input<SocialName[]>(Object.keys(SOCIAL_LINKS) as SocialName[]);

  protected readonly links = computed<SocialLink[]>(() =>
    this.networks().map((name) => SOCIAL_LINKS[name]),
  );
}
