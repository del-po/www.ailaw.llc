import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Header } from '../../shared/components/header/header';
import { Footer } from '../../shared/components/footer/footer';
import { Shape } from '../../shared/kit/shapes/shape';
import { Social } from '../../shared/kit/social/social';

interface Principle {
  title: string;
  text: string;
}

@Component({
  selector: 'app-about-page',
  imports: [RouterLink, Header, Footer, Shape, Social],
  templateUrl: './about-page.html',
  styleUrl: './about-page.scss',
})
export class AboutPage {
  protected readonly principles: Principle[] = [
    {
      title: 'An Unwavering Commitment to Excellence',
      text: 'We deliver the highest caliber of legal service, ensuring meticulous attention to every detail.',
    },
    {
      title: 'Elite Talent',
      text: 'We recruit and nurture the brightest legal minds emerging from academia.',
    },
    {
      title: 'Technological Innovation',
      text: 'We are pioneering the future of legal services through intelligent automation, aiming to make legal support more efficient and accessible.',
    },
  ];
}
