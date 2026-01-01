import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  IonButton,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonTitle,
  IonToolbar,
  IonSelect,
  IonSelectOption,
  IonIcon,
  IonSpinner,
  IonCheckbox,
  IonTextarea,
  ModalController,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { 
  callOutline, personOutline, mailOutline, lockClosedOutline, 
  shieldCheckmarkOutline, alertCircleOutline, homeOutline, locationOutline 
} from 'ionicons/icons';

import { AuthService } from '../services/auth.service';
import { FooterComponent } from '../shared/footer/footer.component';
import { ContactInfoComponent } from '../shared/contact-info/contact-info.component';
import { PendingPurchaseService } from '../services/pending-purchase.service';
import { RazorpayService } from '../services/razorpay.service';

@Component({
  selector: 'app-register',
  templateUrl: './register.page.html',
  styleUrls: ['./register.page.scss'],
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
    IonSelect,
    IonSelectOption,
    IonIcon,
    IonSpinner,
    IonCheckbox,
    IonTextarea,
    FooterComponent,
  ],
})
export class RegisterPage {
  name = '';
  email = '';
  password = '';
  confirmPassword = '';
  countryCode = '+91';
  mobileNumber = '';
  address = '';

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
  pendingPurchaseMessage = '';
  acceptedTerms = false;

  constructor(
    private auth: AuthService,
    private router: Router,
    private pendingPurchase: PendingPurchaseService,
    private razorpay: RazorpayService,
    private modalController: ModalController
  ) {
    addIcons({ 
      callOutline, personOutline, mailOutline, lockClosedOutline, 
      shieldCheckmarkOutline, alertCircleOutline, homeOutline, locationOutline 
    });
  }

  onTermsCheckboxChange(event: any) {
    this.acceptedTerms = event.detail.checked;
  }

  async onRegister() {
    this.errorMessage = '';

    const mobile = this.mobileNumber.trim();
    const mobileError = this.validateMobileNumber(mobile);
    if (mobileError) {
      this.errorMessage = mobileError;
      return;
    }

    const name = this.name.trim();
    const email = this.email.trim();
    const address = this.address.trim();

    if (!email) {
      this.errorMessage = 'Email is required for password recovery';
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      this.errorMessage = 'Please enter a valid email address';
      return;
    }

    if (this.password.length < 6) {
      this.errorMessage = 'Password must be at least 6 characters';
      return;
    }

    if (this.password !== this.confirmPassword) {
      this.errorMessage = 'Passwords do not match';
      return;
    }

    if (!this.acceptedTerms) {
      this.errorMessage = 'Please accept the Terms & Conditions to continue';
      return;
    }

    const fullMobile = `${this.countryCode}${mobile}`;
    const selectedCountry = this.countryCodes.find(c => c.code === this.countryCode);
    const country = selectedCountry?.country || 'India';

    this.isLoading = true;
    try {
      await this.auth.register(name, email, this.password, fullMobile, country, address);
      
      // Check for pending purchase and process it
      const pending = this.pendingPurchase.getPendingPurchase();
      if (pending) {
        await this.processPendingPurchase(pending);
      } else {
        await this.router.navigate(['/events']);
      }
    } catch (e: any) {
      this.errorMessage = e?.error?.error || e?.message || 'Registration failed';
    } finally {
      this.isLoading = false;
    }
  }

  private async processPendingPurchase(pending: { type: 'ticket' | 'season'; eventId?: string; eventTitle?: string }) {
    try {
      if (pending.type === 'season') {
        // Process season ticket purchase
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

        const verifyResult = await this.razorpay.verifySeasonPayment(paymentResult, order.discountedPaise);
        this.pendingPurchase.clearPendingPurchase();
        if (verifyResult.invoiceId) {
          await this.router.navigate(['/invoice', verifyResult.invoiceId], {
            queryParams: { returnUrl: '/events' },
            replaceUrl: true
          });
        } else {
          await this.router.navigate(['/events']);
        }
      } else if (pending.type === 'ticket' && pending.eventId) {
        // Process individual ticket purchase
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

        const verifyResult = await this.razorpay.verifyPayment(paymentResult, pending.eventId, order.amount, order.currency);
        this.pendingPurchase.clearPendingPurchase();
        if (verifyResult.invoiceId) {
          await this.router.navigate(['/invoice', verifyResult.invoiceId], {
            queryParams: { returnUrl: `/event/${pending.eventId}` },
            replaceUrl: true
          });
        } else {
          await this.router.navigate(['/events']);
        }
      } else {
        this.pendingPurchase.clearPendingPurchase();
        await this.router.navigate(['/events']);
      }
    } catch (e: any) {
      this.pendingPurchase.clearPendingPurchase();
      if (e?.message !== 'Payment cancelled by user') {
        this.errorMessage = e?.error?.error || e?.message || 'Payment failed. You can try again from the events page.';
      }
      // Navigate to events page even if payment fails - user is now registered
      await this.router.navigate(['/events']);
    }
  }

  private validateMobileNumber(mobile: string): string | null {
    if (!mobile) {
      return 'Mobile number is required';
    }

    // Remove any spaces or dashes
    const cleanMobile = mobile.replace(/[\s-]/g, '');

    // Check if it contains only digits
    if (!/^\d+$/.test(cleanMobile)) {
      return 'Mobile number should contain only digits';
    }

    // Check length (typically 10 digits for most countries)
    if (cleanMobile.length < 7 || cleanMobile.length > 15) {
      return 'Mobile number should be between 7 and 15 digits';
    }

    // Check for dummy sequential numbers like 1234567890
    const sequentialPatterns = ['1234567890', '0123456789', '9876543210'];
    if (sequentialPatterns.some(p => cleanMobile.includes(p.substring(0, cleanMobile.length)))) {
      return 'Please enter a valid mobile number';
    }

    // Check for all same digits (e.g., 1111111111, 9999999999)
    if (/^(\d)\1+$/.test(cleanMobile)) {
      return 'Please enter a valid mobile number';
    }

    // Check for common dummy patterns
    const dummyPatterns = [
      /^12345/,
      /^11111/,
      /^00000/,
      /^99999/,
      /^123123/,
      /^111222/,
      /^000000/,
    ];
    if (dummyPatterns.some(p => p.test(cleanMobile))) {
      return 'Please enter a valid mobile number';
    }

    return null;
  }

  async openContactInfo() {
    const modal = await this.modalController.create({
      component: ContactInfoComponent,
      cssClass: 'contact-modal',
    });
    await modal.present();
  }
}
