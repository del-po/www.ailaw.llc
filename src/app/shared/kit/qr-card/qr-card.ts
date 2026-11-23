import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Shape } from '../shapes/shape';

// QR code on a frosted square-cut card, links to the About page.
// Set from the parent: --qr-size (the white QR square, default 76px).
// Whole card = --qr-size + 2 × 14px, use that to line things up next to it.
@Component({
  selector: 'app-qr-card',
  imports: [RouterLink, Shape],
  templateUrl: './qr-card.html',
  styleUrl: './qr-card.scss',
})
export class QrCard {}
