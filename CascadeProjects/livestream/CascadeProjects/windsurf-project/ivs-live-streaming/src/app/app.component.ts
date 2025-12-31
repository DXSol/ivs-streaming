import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import {
  IonApp, IonRouterOutlet, IonMenu, IonHeader, IonToolbar, IonTitle,
  IonContent, IonList, IonItem, IonIcon, IonLabel, IonMenuToggle
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { statsChartOutline, addCircleOutline, cardOutline, settingsOutline, peopleOutline, receiptOutline } from 'ionicons/icons';
import { AuthService } from './services/auth.service';

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
export class AppComponent implements OnInit {
  isAdmin = false;

  adminMenuItems = [
    { title: 'Dashboard', url: '/admin/dashboard', icon: 'stats-chart-outline' },
    { title: 'Create Event', url: '/admin/create-event', icon: 'add-circle-outline' },
    { title: 'Subscribers', url: '/admin/mark-paid', icon: 'people-outline' },
    { title: 'Invoice Statement', url: '/admin/invoice-statement', icon: 'receipt-outline' },
  ];

  constructor(private auth: AuthService) {
    addIcons({ statsChartOutline, addCircleOutline, cardOutline, settingsOutline, peopleOutline, receiptOutline });
  }

  async ngOnInit() {
    await this.auth.init();
    const user = this.auth.getUserSync();
    this.isAdmin = user?.role === 'admin';
  }
}
