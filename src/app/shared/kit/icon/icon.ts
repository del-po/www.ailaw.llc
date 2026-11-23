import { Component, computed, input } from '@angular/core';
import { ICONS, IconName } from './icons';

@Component({
  selector: 'app-icon',
  templateUrl: './icon.html',
  styleUrl: './icon.scss',
})
export class Icon {
  readonly name = input.required<IconName>();

  // Screen-reader text; leave empty when the icon sits next to visible text
  readonly label = input<string>('');

  protected readonly icon = computed(() => ICONS[this.name()]);
}
