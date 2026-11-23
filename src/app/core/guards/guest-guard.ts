import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

// Login and register pages: someone already signed in goes to their profile
export const guestGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  await auth.whenReady();
  return auth.signedIn() && !auth.needsVerification() ? router.createUrlTree(['/profile']) : true;
};
