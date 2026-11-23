import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Social } from '../../kit/social/social';
import { QrCard } from '../../kit/qr-card/qr-card';

@Component({
  selector: 'app-footer',
  imports: [RouterLink, Social, QrCard],
  templateUrl: './footer.html',
  styleUrl: './footer.scss',
})
export class Footer {
  protected readonly year = new Date().getFullYear();
}
