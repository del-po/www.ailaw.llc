// Sections of the profile, in menu order. `ready` is false until the
// section has a backend; those pages show a short "coming soon" note.
export interface ProfileSection {
  label: string;
  link: string;
  ready: boolean;
  text: string;
}

export const PROFILE_SECTIONS: ProfileSection[] = [
  { label: 'Overview', link: '/profile', ready: true, text: 'Your account at a glance.' },
  {
    label: 'Orders',
    link: '/profile/orders',
    ready: true,
    text: 'Services you ordered and their progress.',
  },
  {
    label: '1% Declarations',
    link: '/profile/declarations',
    ready: true,
    text: 'Report your monthly income and get your declarations.',
  },
  {
    label: 'Payments',
    link: '/profile/payments',
    ready: false,
    text: 'Invoices and receipts for your orders.',
  },
  {
    label: 'Conversations',
    link: '/profile/conversations',
    ready: false,
    text: 'Your saved chats with AI Law.',
  },
  {
    label: 'Documents',
    link: '/profile/documents',
    ready: false,
    text: 'Contracts, letters and files we prepared for you.',
  },
  {
    label: 'Settings',
    link: '/profile/settings',
    ready: true,
    text: 'Your details, password and account.',
  },
];
