import { authErrorMessage } from '../../core/services/auth-errors';

// Sections of the admin Workspace, in sidebar order. The chat is the start
// page; each section opens in the main area. `count` names the number the
// sidebar shows next to it (see AdminLayout.counts).
export interface AdminSection {
  label: string;
  link: string;
  ready: boolean;
  text: string;
  count?: 'declarations' | 'orders' | 'review' | 'lawyers';
}

export const ADMIN_SECTIONS: AdminSection[] = [
  { label: 'Overview', link: '/admin/overview', ready: true, text: 'The site at a glance.' },
  {
    label: '1% Declarations',
    link: '/admin/declarations',
    ready: true,
    text: 'Monthly income, declarations and delivery.',
    count: 'declarations',
  },
  {
    label: 'Orders',
    link: '/admin/orders',
    ready: true,
    text: 'Orders and their progress.',
    count: 'orders',
  },
  {
    label: 'Review',
    link: '/admin/review',
    ready: true,
    text: 'Order steps waiting for you.',
    count: 'review',
  },
  {
    label: 'Clients',
    link: '/admin/clients',
    ready: true,
    text: 'Every client: accounts, verified clients and guests.',
  },
  {
    label: 'Lawyers',
    link: '/admin/lawyers',
    ready: true,
    text: 'Lawyer applications: approve or decline.',
    count: 'lawyers',
  },
  {
    label: 'Services',
    link: '/admin/services',
    ready: true,
    text: 'Services, prices, discounts and categories.',
  },
  { label: 'Blog', link: '/admin/blog', ready: true, text: 'Write and publish articles.' },
];

// Known codes get a friendly message; anything else is the script's own wording,
// which for admins is a useful validation message (e.g. "Invalid price.")
export function adminErrorMessage(error: unknown): string {
  const message = (error as { message?: string })?.message ?? '';
  const friendly = authErrorMessage(error);
  return friendly && !friendly.startsWith('Something went wrong')
    ? friendly
    : message || 'Something went wrong.';
}
