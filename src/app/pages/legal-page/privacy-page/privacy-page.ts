import { Component, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { Header } from '../../../shared/components/header/header';
import { Footer } from '../../../shared/components/footer/footer';

// Privacy Policy: what personal data AI Law processes, why, and the client's rights
@Component({
  selector: 'app-privacy-page',
  imports: [RouterLink, Header, Footer],
  templateUrl: './privacy-page.html',
  styleUrl: './privacy-page.scss',
})
export class PrivacyPage {
  constructor() {
    inject(Title).setTitle('Privacy Policy | AI Law');
    inject(Meta).updateTag({
      name: 'description',
      content:
        'How AI Law LLC collects, uses and protects personal data, and the rights of clients under Georgian law.',
    });
  }
}
