import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import {
  IonApp, IonRouterOutlet, IonMenu, IonHeader, IonToolbar, IonTitle,
  IonContent, IonList, IonItem, IonIcon, IonLabel, IonMenuToggle
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { statsChartOutline, addCircleOutline, cardOutline, settingsOutline, peopleOutline, receiptOutline } from 'ionicons/icons';
import { AuthService } from './services/auth.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  imports: [
    CommonModule,
    RouterLink,
    IonApp,
    IonRouterOutlet,
    IonMenu,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonList,
    IonItem,
    IonIcon,
    IonLabel,
    IonMenuToggle
  ],
})
export class AppComponent implements OnInit, OnDestroy {
  isAdmin = false;
  private authSubscription?: Subscription;
  private userRole: 'viewer' | 'admin' | 'superadmin' | 'finance-admin' | 'content-admin' | null = null;

  adminMenuItems = [
    { title: 'Dashboard', url: '/admin/dashboard', icon: 'stats-chart-outline', roles: ['superadmin', 'admin', 'content-admin'] },
    { title: 'Create Event', url: '/admin/create-event', icon: 'add-circle-outline', roles: ['superadmin', 'admin', 'content-admin'] },
    { title: 'Subscribers', url: '/admin/mark-paid', icon: 'people-outline', roles: ['superadmin', 'admin'] },
    { title: 'Invoice Statement', url: '/admin/invoice-statement', icon: 'receipt-outline', roles: ['superadmin', 'admin', 'finance-admin'] },
    { title: 'Pending USD Invoices', url: '/admin/pending-usd-invoices', icon: 'card-outline', roles: ['superadmin', 'admin', 'finance-admin'] },
    { title: 'Manage Users', url: '/admin/manage-users', icon: 'settings-outline', roles: ['superadmin'] },
  ];

  get visibleMenuItems() {
    if (!this.userRole) return [];
    return this.adminMenuItems.filter(item => item.roles.includes(this.userRole!));
  }

  constructor(private auth: AuthService) {
    addIcons({ statsChartOutline, addCircleOutline, cardOutline, settingsOutline, peopleOutline, receiptOutline });
  }

  async ngOnInit() {
    await this.auth.init();
    
    // Subscribe to auth state changes to update admin status reactively
    this.authSubscription = this.auth.user$.subscribe(user => {
      this.userRole = user?.role || null;
      this.isAdmin = user?.role === 'admin' || user?.role === 'superadmin' || user?.role === 'finance-admin' || user?.role === 'content-admin';
    });
  }

  ngOnDestroy() {
    this.authSubscription?.unsubscribe();
  }
}
