import { inject } from '@angular/core';
import { CanMatchFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

// Workspace: signed in with an approved lawyer login.
// The chat function checks the login again on every request, so this only decides what to show.
export const staffGuard: CanMatchFn = async (_route, segments) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  await auth.whenReady();

  if (!auth.signedIn()) {
    const returnUrl = '/' + segments.map((s) => s.path).join('/');
    return router.createUrlTree(['/login'], { queryParams: { returnUrl } });
  }
  return auth.isStaff() ? true : router.createUrlTree(['/']);
};
