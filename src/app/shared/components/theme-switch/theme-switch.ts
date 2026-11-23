import { Component, inject } from '@angular/core';
import { ThemeService } from '../../../core/services/theme.service';

@Component({
  selector: 'app-theme-switch',
  templateUrl: './theme-switch.html',
  styleUrl: './theme-switch.scss',
})
export class ThemeSwitch {
  protected readonly theme = inject(ThemeService);
}
