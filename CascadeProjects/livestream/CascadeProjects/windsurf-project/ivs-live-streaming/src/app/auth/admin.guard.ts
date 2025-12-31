import { CanActivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';
import { AuthService } from '../services/auth.service';

export const adminGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const ok = await auth.isLoggedIn();
  if (!ok) {
    await router.navigate(['/login']);
    return false;
  }

  const user = auth.getUserSync();
  if (!user || user.role !== 'admin') {
    await router.navigate(['/events']);
    return false;
  }

  return true;
};
