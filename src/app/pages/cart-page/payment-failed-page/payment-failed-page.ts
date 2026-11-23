import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Header } from '../../../shared/components/header/header';
import { Footer } from '../../../shared/components/footer/footer';
import { Shape } from '../../../shared/kit/shapes/shape';

// Where the bank sends the client when payment fails or is cancelled.
// The cart is kept, so trying again needs no re-adding.
@Component({
  selector: 'app-payment-failed-page',
  imports: [RouterLink, Header, Footer, Shape],
  templateUrl: './payment-failed-page.html',
  styleUrl: '../payment-success-page/payment-success-page.scss',
})
export class PaymentFailedPage {}
