import { inject } from '@angular/core';
import { CanMatchFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

// Admin pages: signed in, and Role "admin" in the Users sheet.
// The scripts check the role again on every request, so this only decides what to show.
export const adminGuard: CanMatchFn = async (_route, segments) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  await auth.whenReady();

  if (!auth.signedIn()) {
    const returnUrl = '/' + segments.map((s) => s.path).join('/');
    return router.createUrlTree(['/login'], { queryParams: { returnUrl } });
  }

  try {
    const profile = await auth.loadProfile();
    return profile.Role === 'admin' && profile.Status === 'active'
      ? true
      : router.createUrlTree(['/']);
  } catch {
    return router.createUrlTree(['/']);
  }
};
