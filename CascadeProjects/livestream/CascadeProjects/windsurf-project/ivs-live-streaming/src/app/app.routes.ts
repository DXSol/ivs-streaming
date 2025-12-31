import { Routes } from '@angular/router';
import { authGuard } from './auth/auth.guard';
import { adminGuard } from './auth/admin.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./login/login.page').then((m) => m.LoginPage),
  },
  {
    path: 'register',
    loadComponent: () => import('./register/register.page').then((m) => m.RegisterPage),
  },
  {
    path: 'forgot-password',
    loadComponent: () => import('./forgot-password/forgot-password.page').then((m) => m.ForgotPasswordPage),
  },
  {
    path: 'reset-password',
    loadComponent: () => import('./reset-password/reset-password.page').then((m) => m.ResetPasswordPage),
  },
  {
    path: 'events',
    loadComponent: () => import('./events/events.page').then((m) => m.EventsPage),
  },
  {
    path: 'events/:id',
    loadComponent: () => import('./event-detail/event-detail.page').then((m) => m.EventDetailPage),
  },
  {
    path: 'admin/mark-paid',
    canActivate: [adminGuard],
    loadComponent: () => import('./admin-mark-paid/admin-mark-paid.page').then((m) => m.AdminMarkPaidPage),
  },
  {
    path: 'admin/create-event',
    canActivate: [adminGuard],
    loadComponent: () => import('./admin/create-event/create-event.page').then((m) => m.CreateEventPage),
  },
  {
    path: 'admin/dashboard',
    canActivate: [adminGuard],
    loadComponent: () => import('./admin/dashboard/dashboard.page').then((m) => m.DashboardPage),
  },
  {
    path: 'admin/edit-event/:id',
    canActivate: [adminGuard],
    loadComponent: () => import('./admin/edit-event/edit-event.page').then((m) => m.EditEventPage),
  },
  {
    path: 'watch/:id',
    canActivate: [authGuard],
    loadComponent: () => import('./watch/watch.page').then((m) => m.WatchPage),
  },
  {
    path: 'profile',
    canActivate: [authGuard],
    loadComponent: () => import('./profile/profile.page').then(m => m.ProfilePage),
  },
  {
    path: 'terms',
    loadComponent: () => import('./terms/terms.page').then(m => m.TermsPage),
  },
  {
    path: 'invoice/:id',
    canActivate: [authGuard],
    loadComponent: () => import('./invoice/invoice.page').then(m => m.InvoicePage)
  },
  {
    path: 'admin/invoice-statement',
    canActivate: [adminGuard],
    loadComponent: () => import('./admin/invoice-statement/invoice-statement.page').then(m => m.InvoiceStatementPage)
  },
  {
    path: '',
    redirectTo: 'events',
    pathMatch: 'full',
  },
  {
    path: '**',
    redirectTo: 'events',
  },
];
