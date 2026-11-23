import { Component, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { Header } from '../../shared/components/header/header';
import { Footer } from '../../shared/components/footer/footer';

interface Entry {
  place: string;
  role: string;
  years: string;
  completed?: boolean; // education only
}

@Component({
  selector: 'app-bio-page',
  imports: [Header, Footer],
  templateUrl: './bio-page.html',
  styleUrl: './bio-page.scss',
})
export class BioPage {
  protected readonly experience: Entry[] = [
    { place: 'GIG', role: 'Senior Lawyer', years: '2025 — ∞' },
    { place: 'AI Law LLC', role: 'CEO', years: '2020 — ∞' },
    { place: 'Tbilisi State University', role: 'Vis Moot Team Coach', years: '2023 — 2024' },
    { place: 'Tbilisi State University', role: 'Invited Lecturer', years: '2020 — 2023' },
    { place: 'BB Legal', role: 'Partner & Legal Director', years: '2021' },
    { place: 'City Loft LLC', role: 'Chief Legal Counsel', years: '2020 — 2021' },
    { place: 'BLC Law Office', role: 'Associate Attorney', years: '2015 — 2020' },
    { place: 'Ministry of Justice of Georgia', role: 'Visiting Scholar', years: '2014' },
    { place: 'NGO Human Rights Priority', role: 'Lawyer', years: '2013 — 2014' },
  ];

  protected readonly education: Entry[] = [
    {
      place: 'University of Illinois Urbana-Champaign',
      role: 'College of Law · J.S.D.',
      years: 'Class of 2028',
      completed: false,
    },
    {
      place: 'University of Illinois Urbana-Champaign',
      role: 'College of Law · LL.M.',
      years: 'Class of 2017',
      completed: true,
    },
    {
      place: 'Tbilisi State University',
      role: 'Faculty of Law · LL.M.',
      years: 'Class of 2017',
      completed: false,
    },
    {
      place: 'Tbilisi State University',
      role: 'Faculty of Law · LL.B.',
      years: 'Class of 2015',
      completed: true,
    },
  ];

  protected readonly links = {
    school:
      'https://303.ge/hz/blog/music-production-is-kursdamtavrebulebma-finaluri-namushevrebi-tsaradgines-es-is-etapia-rodesats-teoriuli-tsodna-da-chventan-gatarebuli-saatebi-konkretul-zhgheradobad-iqtseva',
    certificate: 'https://www.instagram.com/p/DXrccBJCHlc/?img_index=1',
    soundcloud: 'https://soundcloud.com/ailawllc',
    spotify: 'https://open.spotify.com/artist/3a4rUIVSrumlcnyMCW5kT9',
    apple: 'https://music.apple.com/us/artist/ailaw/1896030405',
    youtube: 'https://www.youtube.com/watch?v=dfXXX9SRSo8',
  };

  constructor() {
    inject(Title).setTitle('Gocha Okreshidze | AI Law');
    inject(Meta).updateTag({
      name: 'description',
      content:
        'Gocha Okreshidze, founder of AI Law: licensed attorney in Tbilisi, more than 300 litigations and 200 businesses launched.',
    });
  }
}
