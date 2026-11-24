import { authErrorMessage } from '../../core/services/auth-errors';

// Sections of the admin area, in menu order. `ready` is false until the
// section has a backend; those pages show a short "coming soon" note.
export interface AdminSection {
  label: string;
  link: string;
  ready: boolean;
  text: string;
}

export const ADMIN_SECTIONS: AdminSection[] = [
  { label: 'Dashboard', link: '/admin', ready: true, text: 'The site at a glance.' },
  {
    label: 'Services',
    link: '/admin/services',
    ready: true,
    text: 'Services, prices, discounts and categories.',
  },
  { label: 'Clients', link: '/admin/clients', ready: true, text: 'Everyone with an account.' },
  {
    label: 'Lawyers',
    link: '/admin/lawyers',
    ready: true,
    text: 'Lawyer applications: approve or decline.',
  },
  { label: 'Orders', link: '/admin/orders', ready: true, text: 'Orders and their progress.' },
  { label: 'Blog', link: '/admin/blog', ready: true, text: 'Published articles.' },
  {
    label: 'Review',
    link: '/admin/review',
    ready: true,
    text: 'Order steps waiting for you.',
  },
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
