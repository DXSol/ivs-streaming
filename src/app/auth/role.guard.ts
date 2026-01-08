import { CanActivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';
import { AuthService, UserRole } from '../services/auth.service';

export function createRoleGuard(allowedRoles: UserRole[]): CanActivateFn {
  return async () => {
    const auth = inject(AuthService);
    const router = inject(Router);

    const ok = await auth.isLoggedIn();
    if (!ok) {
      await router.navigate(['/login']);
      return false;
    }

    const user = auth.getUserSync();
    if (!user || !allowedRoles.includes(user.role)) {
      await router.navigate(['/events']);
      return false;
    }

    return true;
  };
}

// Pre-defined guards for common role combinations
export const superAdminGuard = createRoleGuard(['superadmin']);
export const contentAdminGuard = createRoleGuard(['superadmin', 'admin', 'content-admin']);
export const financeAdminGuard = createRoleGuard(['superadmin', 'admin', 'finance-admin']);
export const fullAdminGuard = createRoleGuard(['superadmin', 'admin']);
