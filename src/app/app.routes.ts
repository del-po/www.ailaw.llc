import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth-guard';
import { adminGuard } from './core/guards/admin-guard';
import { guestGuard } from './core/guards/guest-guard';
import { authActionGuard } from './core/guards/auth-action-guard';
import { staffGuard } from './core/guards/staff-guard';

export const routes: Routes = [
  // Main
  { path: '', loadComponent: () => import('./pages/home-page/home-page').then((m) => m.HomePage) },
  {
    path: 'chat',
    loadComponent: () => import('./pages/chat-page/chat-page').then((m) => m.ChatPage),
  },
  {
    path: 'about',
    loadComponent: () => import('./pages/about-page/about-page').then((m) => m.AboutPage),
  },

  // Services
  {
    path: 'services',
    loadComponent: () =>
      import('./pages/services-page/services-list-page/services-list-page').then(
        (m) => m.ServicesListPage,
      ),
  },
  {
    path: 'services/:slug',
    loadComponent: () =>
      import('./pages/services-page/service-details-page/service-details-page').then(
        (m) => m.ServiceDetailsPage,
      ),
  },

  // Blog
  {
    path: 'blog',
    loadComponent: () =>
      import('./pages/blog-page/blog-list-page/blog-list-page').then((m) => m.BlogListPage),
  },
  {
    path: 'blog/:slug',
    loadComponent: () =>
      import('./pages/blog-page/blog-post-page/blog-post-page').then((m) => m.BlogPostPage),
  },

  // Cart
  {
    path: 'cart',
    loadComponent: () =>
      import('./pages/cart-page/cart-items-page/cart-items-page').then((m) => m.CartItemsPage),
  },
  {
    path: 'checkout',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/cart-page/checkout-page/checkout-page').then((m) => m.CheckoutPage),
  },
  {
    path: 'payment/success',
    loadComponent: () =>
      import('./pages/cart-page/payment-success-page/payment-success-page').then(
        (m) => m.PaymentSuccessPage,
      ),
  },
  {
    path: 'payment/failed',
    loadComponent: () =>
      import('./pages/cart-page/payment-failed-page/payment-failed-page').then(
        (m) => m.PaymentFailedPage,
      ),
  },

  // Auth
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./pages/auth-page/login-page/login-page').then((m) => m.LoginPage),
  },
  {
    path: 'register',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./pages/auth-page/register-page/register-page').then((m) => m.RegisterPage),
  },
  {
    path: 'verify-email',
    loadComponent: () =>
      import('./pages/auth-page/verify-email-page/verify-email-page').then(
        (m) => m.VerifyEmailPage,
      ),
  },
  {
    path: 'forgot-password',
    loadComponent: () =>
      import('./pages/auth-page/forgot-password-page/forgot-password-page').then(
        (m) => m.ForgotPasswordPage,
      ),
  },
  {
    path: 'reset-password',
    loadComponent: () =>
      import('./pages/auth-page/reset-password-page/reset-password-page').then(
        (m) => m.ResetPasswordPage,
      ),
  },
  { path: 'auth/action', canActivate: [authActionGuard], children: [] },

  // Lawyer applications (public, no account needed)
  {
    path: 'join',
    loadComponent: () =>
      import('./pages/auth-page/lawyer-apply-page/lawyer-apply-page').then(
        (m) => m.LawyerApplyPage,
      ),
  },

  // Legal
  {
    path: 'privacy',
    loadComponent: () =>
      import('./pages/legal-page/privacy-page/privacy-page').then((m) => m.PrivacyPage),
  },
  {
    path: 'terms',
    loadComponent: () =>
      import('./pages/legal-page/terms-page/terms-page').then((m) => m.TermsPage),
  },

  // Profile (logged-in clients only)
  {
    path: 'profile',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/profile-page/profile-layout/profile-layout').then((m) => m.ProfileLayout),
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./pages/profile-page/profile-overview-page/profile-overview-page').then(
            (m) => m.ProfileOverviewPage,
          ),
      },
      {
        path: 'orders',
        loadComponent: () =>
          import('./pages/profile-page/profile-orders-page/profile-orders-page').then(
            (m) => m.ProfileOrdersPage,
          ),
      },
      {
        path: 'payments',
        loadComponent: () =>
          import('./pages/profile-page/profile-payments-page/profile-payments-page').then(
            (m) => m.ProfilePaymentsPage,
          ),
      },
      {
        path: 'conversations',
        loadComponent: () =>
          import('./pages/profile-page/profile-conversations-page/profile-conversations-page').then(
            (m) => m.ProfileConversationsPage,
          ),
      },
      {
        path: 'declarations',
        loadComponent: () =>
          import('./pages/profile-page/profile-declarations-page/profile-declarations-page').then(
            (m) => m.ProfileDeclarationsPage,
          ),
      },
      {
        path: 'documents',
        loadComponent: () =>
          import('./pages/profile-page/profile-documents-page/profile-documents-page').then(
            (m) => m.ProfileDocumentsPage,
          ),
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./pages/profile-page/profile-settings-page/profile-settings-page').then(
            (m) => m.ProfileSettingsPage,
          ),
      },
    ],
  },

  // Workspace (approved lawyers only)
  {
    path: 'workspace',
    canMatch: [staffGuard],
    loadComponent: () =>
      import('./pages/workspace-page/workspace-page').then((m) => m.WorkspacePage),
  },

  // Bio

  { path: 'bio', loadComponent: () => import('./pages/bio-page/bio-page').then((m) => m.BioPage) },

  // Admin (owner only)
  {
    path: 'admin',
    canMatch: [adminGuard],
    loadComponent: () =>
      import('./pages/admin-page/admin-layout/admin-layout').then((m) => m.AdminLayout),
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./pages/admin-page/admin-dashboard-page/admin-dashboard-page').then(
            (m) => m.AdminDashboardPage,
          ),
      },
      {
        path: 'services',
        loadComponent: () =>
          import('./pages/admin-page/admin-services-page/admin-services-page').then(
            (m) => m.AdminServicesPage,
          ),
      },
      {
        path: 'clients',
        loadComponent: () =>
          import('./pages/admin-page/admin-clients-page/admin-clients-page').then(
            (m) => m.AdminClientsPage,
          ),
      },
      {
        path: 'lawyers',
        loadComponent: () =>
          import('./pages/admin-page/admin-lawyers-page/admin-lawyers-page').then(
            (m) => m.AdminLawyersPage,
          ),
      },
      {
        path: 'orders',
        loadComponent: () =>
          import('./pages/admin-page/admin-orders-page/admin-orders-page').then(
            (m) => m.AdminOrdersPage,
          ),
      },
      {
        path: 'declarations',
        loadComponent: () =>
          import('./pages/admin-page/admin-declarations-page/admin-declarations-page').then(
            (m) => m.AdminDeclarationsPage,
          ),
      },
      {
        path: 'blog',
        loadComponent: () =>
          import('./pages/admin-page/admin-blog-page/admin-blog-page').then((m) => m.AdminBlogPage),
      },
      {
        path: 'review',
        loadComponent: () =>
          import('./pages/admin-page/admin-review-page/admin-review-page').then(
            (m) => m.AdminReviewPage,
          ),
      },
    ],
  },

  // Unknown URLs
  { path: '**', redirectTo: '' },
];
