import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { RouterLink } from '@angular/router';
import {
  IonButton,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonTitle,
  IonToolbar,
  IonIcon,
  IonSpinner,
  IonSelect,
  IonSelectOption,
  ModalController,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { callOutline, lockClosedOutline, alertCircleOutline, homeOutline } from 'ionicons/icons';

import { AuthService } from '../services/auth.service';
import { FooterComponent } from '../shared/footer/footer.component';
import { ContactInfoComponent } from '../shared/contact-info/contact-info.component';
import { PendingPurchaseService } from '../services/pending-purchase.service';
import { RazorpayService } from '../services/razorpay.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonItem,
    IonInput,
    IonButton,
    IonIcon,
    IonSpinner,
    IonSelect,
    IonSelectOption,
    FooterComponent,
  ],
})
export class LoginPage {
  countryCode = '+91';
  mobileNumber = '';
  password = '';

  countryCodes = [
    { code: '+91', country: 'India', flag: '🇮🇳' },
    { code: '+1', country: 'USA/Canada', flag: '🇺🇸' },
    { code: '+44', country: 'UK', flag: '🇬🇧' },
    { code: '+61', country: 'Australia', flag: '🇦🇺' },
    { code: '+49', country: 'Germany', flag: '🇩🇪' },
    { code: '+971', country: 'UAE', flag: '🇦🇪' },
    { code: '+966', country: 'Saudi Arabia', flag: '🇸🇦' },
    { code: '+974', country: 'Qatar', flag: '🇶🇦' },
    { code: '+965', country: 'Kuwait', flag: '🇰🇼' },
    { code: '+968', country: 'Oman', flag: '🇴🇲' },
    { code: '+973', country: 'Bahrain', flag: '🇧🇭' },
  ];

  isLoading = false;
  errorMessage = '';

  constructor(
    private auth: AuthService,
    private router: Router,
    private pendingPurchase: PendingPurchaseService,
    private razorpay: RazorpayService,
    private modalController: ModalController
  ) {
    addIcons({ callOutline, lockClosedOutline, alertCircleOutline, homeOutline });
  }

  async onLogin() {
    this.errorMessage = '';
    this.isLoading = true;

    try {
      const fullMobile = this.countryCode + this.mobileNumber.trim();
      await this.auth.login(fullMobile, this.password);
      
      // Check for pending purchase and process it
      const pending = this.pendingPurchase.getPendingPurchase();
      if (pending) {
        await this.processPendingPurchase(pending);
      } else {
        await this.router.navigate(['/events']);
      }
    } catch (e: any) {
      this.errorMessage = e?.error?.error || e?.message || 'Login failed';
    } finally {
      this.isLoading = false;
    }
  }

  private async processPendingPurchase(pending: { type: 'ticket' | 'season'; eventId?: string; eventTitle?: string }) {
    try {
      if (pending.type === 'season') {
        const order = await this.razorpay.createSeasonOrder();
        const user = this.auth.getUserSync();

        const paymentResult = await this.razorpay.openPaymentModal({
          orderId: order.orderId,
          amount: order.amount,
          currency: order.currency,
          name: 'Sankeertanotsav 2026',
          description: 'Season Ticket - Access to all events',
          prefillEmail: user?.email,
        });

        await this.razorpay.verifySeasonPayment(paymentResult, order.discountedPaise);
        this.pendingPurchase.clearPendingPurchase();
        await this.router.navigate(['/events']);
      } else if (pending.type === 'ticket' && pending.eventId) {
        const order = await this.razorpay.createOrder(pending.eventId);
        const user = this.auth.getUserSync();

        const paymentResult = await this.razorpay.openPaymentModal({
          orderId: order.orderId,
          amount: order.amount,
          currency: order.currency,
          name: 'Sankeertanotsav 2026',
          description: `Ticket for ${pending.eventTitle || 'Event'}`,
          prefillEmail: user?.email,
        });

        await this.razorpay.verifyPayment(paymentResult, pending.eventId, order.amount, order.currency);
        this.pendingPurchase.clearPendingPurchase();
        await this.router.navigate(['/events']);
      } else {
        this.pendingPurchase.clearPendingPurchase();
        await this.router.navigate(['/events']);
      }
    } catch (e: any) {
      this.pendingPurchase.clearPendingPurchase();
      if (e?.message !== 'Payment cancelled by user') {
        this.errorMessage = e?.error?.error || e?.message || 'Payment failed. You can try again from the events page.';
      }
      await this.router.navigate(['/events']);
    }
  }

  async openContactInfo() {
    const modal = await this.modalController.create({
      component: ContactInfoComponent,
      cssClass: 'contact-modal',
    });
    await modal.present();
  }
}
