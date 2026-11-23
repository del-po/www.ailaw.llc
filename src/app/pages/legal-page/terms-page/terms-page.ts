import { Component, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { Header } from '../../../shared/components/header/header';
import { Footer } from '../../../shared/components/footer/footer';

// E-Commerce Standards: company details, contacts, terms, delivery and refunds.
// The text is the published legal wording, kept exactly as written.
@Component({
  selector: 'app-terms-page',
  imports: [Header, Footer],
  templateUrl: './terms-page.html',
  styleUrl: './terms-page.scss',
})
export class TermsPage {
  constructor() {
    inject(Title).setTitle('Terms | AI Law');
    inject(Meta).updateTag({
      name: 'description',
      content:
        'AI Law LLC company information, contact details, Terms and Conditions, Service Delivery Policy and Return and Refund Policy.',
    });
  }
}
