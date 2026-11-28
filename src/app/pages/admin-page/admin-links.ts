import { authErrorMessage } from '../../core/services/auth-errors';

// Sections of the Admin Control Panel, in sidebar order. The Dashboard is the
// start page; each section opens in the main area. `count` names the number
// the sidebar shows next to it (see AdminLayout.counts); `children` are
// shown under it (Review under Orders, each special service under Special
// Services). A section without a link is only a heading for its children.
// `ready: false` opens the "coming soon" page (AdminSoon).
export type AdminCount = 'declarations' | 'orders' | 'review' | 'lawyers';

export interface AdminSection {
  label: string;
  link: string;
  ready: boolean;
  text: string;
  count?: AdminCount;
  children?: AdminSection[];
}

export const ADMIN_SECTIONS: AdminSection[] = [
  { label: 'Dashboard', link: '/admin', ready: true, text: 'The whole business at a glance.' },
  {
    label: 'Clients',
    link: '/admin/clients',
    ready: true,
    text: 'Every client: profiles, verification, account status and internal notes.',
  },
  {
    label: 'Orders',
    link: '/admin/orders',
    ready: true,
    text: 'Orders, prices, assignments, agreements and payment records.',
    count: 'orders',
    children: [
      {
        label: 'Review',
        link: '/admin/review',
        ready: true,
        text: 'Order steps waiting for AI Law.',
        count: 'review',
      },
    ],
  },
  {
    label: 'Services',
    link: '/admin/services',
    ready: true,
    text: 'The catalogue: services, prices, discounts, checkout fields and categories.',
  },
  {
    label: 'Lawyers & Staff',
    link: '/admin/lawyers',
    ready: true,
    text: 'Applications, profiles, accounts and assignments.',
    count: 'lawyers',
  },
  {
    label: 'Documents',
    link: '/admin/documents',
    ready: true,
    text: 'One place to find and manage the documents of every client and order.',
  },
  {
    label: 'Content',
    link: '/admin/content',
    ready: false,
    text: 'The website’s text: homepage, About, contacts, FAQs, announcements and policies.',
  },
  { label: 'Blog', link: '/admin/blog', ready: true, text: 'Write, publish and manage articles.' },
  {
    label: 'AI Management',
    link: '/admin/ai',
    ready: false,
    text: 'Models, instructions, knowledge, plugins and AI usage.',
  },
  {
    label: 'Communications',
    link: '/admin/communications',
    ready: false,
    text: 'Client conversations, notifications and their templates.',
  },
  {
    label: 'Analytics & Logs',
    link: '/admin/logs',
    ready: true,
    text: 'Who changed what and when, and what failed.',
  },
  {
    label: 'System Settings',
    link: '/admin/settings',
    ready: false,
    text: 'Company details, integrations, notifications and permissions.',
  },
  {
    label: 'Special Services',
    link: '',
    ready: true,
    text: 'Services with their own workflows.',
    children: [
      {
        label: '1% Declarations',
        link: '/admin/declarations',
        ready: true,
        text: 'Monthly income, declarations and delivery.',
        count: 'declarations',
      },
    ],
  },
];

// Every section and sub-section, for lookups by link
export const ALL_ADMIN_SECTIONS: AdminSection[] = ADMIN_SECTIONS.flatMap((s) => [
  s,
  ...(s.children ?? []),
]);

// Known codes get a friendly message; anything else is the backend's own wording,
// which for admins is a useful validation message (e.g. "Invalid price.")
export function adminErrorMessage(error: unknown): string {
  const message = (error as { message?: string })?.message ?? '';
  const friendly = authErrorMessage(error);
  return friendly && !friendly.startsWith('Something went wrong')
    ? friendly
    : message || 'Something went wrong.';
}
