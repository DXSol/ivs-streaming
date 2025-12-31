import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { ToastController } from '@ionic/angular/standalone';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const toastController = inject(ToastController);
  const token = auth.getAccessTokenSync();

  let authReq = req;
  if (token) {
    authReq = req.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`,
      },
    });
  }

  return next(authReq).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401) {
        handleAuthError(auth, router, toastController, 'Session expired. Please login again.');
      } else if (error.status === 403) {
        const message = error.error?.error || 'Access denied';
        showToast(toastController, message, 'warning');
      }
      return throwError(() => error);
    })
  );
};

async function handleAuthError(
  auth: AuthService,
  router: Router,
  toastController: ToastController,
  message: string
) {
  await auth.logout();
  await showToast(toastController, message, 'danger');
  router.navigate(['/login'], { replaceUrl: true });
}

async function showToast(
  toastController: ToastController,
  message: string,
  color: 'danger' | 'warning' | 'success' = 'danger'
) {
  const toast = await toastController.create({
    message,
    duration: 3000,
    position: 'top',
    color,
  });
  await toast.present();
}
