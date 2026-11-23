import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

// Every Firebase email link opens /auth/action?mode=…&oobCode=…
// This sends it on to the page for that kind of link.
const PAGES: Record<string, string> = {
  verifyEmail: '/verify-email',
  resetPassword: '/reset-password',
};

export const authActionGuard: CanActivateFn = (route) => {
  const router = inject(Router);
  const page = PAGES[route.queryParamMap.get('mode') ?? ''] ?? '/login';

  return router.createUrlTree([page], { queryParams: route.queryParams });
};
