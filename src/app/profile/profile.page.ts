import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
  IonButtons,
  IonBackButton,
  IonButton,
  IonItem,
  IonInput,
  IonTextarea,
  IonIcon,
  IonSpinner,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  personOutline, mailOutline, callOutline, globeOutline, locationOutline,
  saveOutline, alertCircleOutline, checkmarkCircleOutline,
  lockClosedOutline, keyOutline, chevronDownOutline, chevronUpOutline,
  receiptOutline, downloadOutline
} from 'ionicons/icons';

import { AuthService, User, Invoice } from '../services/auth.service';
import { FooterComponent } from '../shared/footer/footer.component';

@Component({
  selector: 'app-profile',
  templateUrl: './profile.page.html',
  styleUrls: ['./profile.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonButtons,
    IonBackButton,
    IonButton,
    IonItem,
    IonInput,
    IonTextarea,
    IonIcon,
    IonSpinner,
    FooterComponent,
  ]
})
export class ProfilePage implements OnInit {
  user: User | null = null;
  
  name = '';
  email = '';
  mobile = '';
  country = '';
  address = '';

  isLoading = false;
  isSaving = false;
  errorMessage = '';
  successMessage = '';

  currentPassword = '';
  newPassword = '';
  confirmNewPassword = '';
  isChangingPassword = false;
  passwordErrorMessage = '';
  passwordSuccessMessage = '';
  showPasswordSection = false;

  totalPaidRupees = 0;
  isLoadingPayments = false;

  invoices: Invoice[] = [];
  isLoadingInvoices = false;
  showInvoicesSection = false;

  constructor(
    private auth: AuthService,
    private router: Router
  ) {
    addIcons({
      personOutline, mailOutline, callOutline, globeOutline, locationOutline,
      saveOutline, alertCircleOutline, checkmarkCircleOutline,
      lockClosedOutline, keyOutline, chevronDownOutline, chevronUpOutline,
      receiptOutline, downloadOutline
    });
  }

  async ngOnInit() {
    this.isLoading = true;
    try {
      this.user = this.auth.getUserSync();
      if (this.user) {
        this.name = this.user.name || '';
        this.email = this.user.email || '';
        this.mobile = this.user.mobile || '';
        this.country = this.user.country || '';
        this.address = this.user.address || '';
      }
      await this.loadPaymentSummary();
      await this.loadInvoices();
    } finally {
      this.isLoading = false;
    }
  }

  async loadInvoices() {
    this.isLoadingInvoices = true;
    try {
      const result = await this.auth.getInvoices();
      this.invoices = result.invoices;
    } catch (e) {
      console.error('Failed to load invoices:', e);
    } finally {
      this.isLoadingInvoices = false;
    }
  }

  toggleInvoicesSection() {
    this.showInvoicesSection = !this.showInvoicesSection;
  }

  viewInvoice(invoice: Invoice) {
    this.router.navigate(['/invoice', invoice.id], {
      queryParams: { returnUrl: '/profile' }
    });
  }

  getInvoiceTypeLabel(type: string): string {
    return type === 'season_ticket' ? 'Season Ticket' : 'Event Ticket';
  }

  formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  async loadPaymentSummary() {
    this.isLoadingPayments = true;
    try {
      const summary = await this.auth.getPaymentSummary();
      this.totalPaidRupees = summary.totalPaidRupees;
    } catch (e) {
      console.error('Failed to load payment summary:', e);
    } finally {
      this.isLoadingPayments = false;
    }
  }

  async saveProfile() {
    this.errorMessage = '';
    this.successMessage = '';

    if (!this.name.trim()) {
      this.errorMessage = 'Name is required';
      return;
    }

    this.isSaving = true;
    try {
      await this.auth.updateProfile({
        name: this.name.trim(),
        email: this.email.trim() || undefined,
        address: this.address.trim() || undefined,
      });
      this.successMessage = 'Profile updated successfully!';
      
      // Refresh user data
      this.user = this.auth.getUserSync();
    } catch (e: any) {
      this.errorMessage = e?.error?.error || e?.message || 'Failed to update profile';
    } finally {
      this.isSaving = false;
    }
  }

  async changePassword() {
    this.passwordErrorMessage = '';
    this.passwordSuccessMessage = '';

    if (!this.currentPassword) {
      this.passwordErrorMessage = 'Current password is required';
      return;
    }

    if (this.newPassword.length < 6) {
      this.passwordErrorMessage = 'New password must be at least 6 characters';
      return;
    }

    if (this.newPassword !== this.confirmNewPassword) {
      this.passwordErrorMessage = 'New passwords do not match';
      return;
    }

    this.isChangingPassword = true;
    try {
      await this.auth.changePassword(this.currentPassword, this.newPassword);
      this.passwordSuccessMessage = 'Password changed successfully!';
      this.currentPassword = '';
      this.newPassword = '';
      this.confirmNewPassword = '';
    } catch (e: any) {
      this.passwordErrorMessage = e?.error?.error || e?.message || 'Failed to change password';
    } finally {
      this.isChangingPassword = false;
    }
  }
}
