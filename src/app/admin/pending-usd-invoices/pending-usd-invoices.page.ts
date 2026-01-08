import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  IonButton,
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
  IonButtons,
  IonBackButton,
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonCardContent,
  IonList,
  IonItem,
  IonLabel,
  IonInput,
  IonSpinner,
  AlertController,
  ToastController,
} from '@ionic/angular/standalone';
import {
  AdminApiService,
  PendingUSDInvoice,
} from '../../services/admin-api.service';

@Component({
  selector: 'app-pending-usd-invoices',
  templateUrl: './pending-usd-invoices.page.html',
  styleUrls: ['./pending-usd-invoices.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonButtons,
    IonBackButton,
    IonButton,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardContent,
    IonList,
    IonItem,
    IonLabel,
    IonInput,
    IonSpinner,
  ],
})
export class PendingUsdInvoicesPage implements OnInit {
  pendingInvoices: PendingUSDInvoice[] = [];
  isLoading = true;
  errorMessage = '';
  exchangeRates: Map<string, number> = new Map();
  processingPaymentIds: Set<string> = new Set();

  constructor(
    private adminApi: AdminApiService,
    private alertController: AlertController,
    private toastController: ToastController,
    private router: Router
  ) {}

  async ngOnInit() {
    await this.loadPendingInvoices();
  }

  async loadPendingInvoices() {
    this.isLoading = true;
    this.errorMessage = '';

    try {
      this.pendingInvoices = await this.adminApi.listPendingUSDInvoices();
      // Do not initialize exchange rates - let user enter them
    } catch (error: any) {
      this.errorMessage =
        error?.error?.error || 'Failed to load pending invoices';
    } finally {
      this.isLoading = false;
    }
  }

  getExchangeRate(paymentId: string): number | null {
    return this.exchangeRates.get(paymentId) || null;
  }

  setExchangeRate(paymentId: string, rate: string | number | null | undefined) {
    if (!rate || rate === '') {
      this.exchangeRates.delete(paymentId);
      return;
    }
    const numericRate = typeof rate === 'string' ? parseFloat(rate) : rate;
    if (numericRate && numericRate > 0) {
      this.exchangeRates.set(paymentId, numericRate);
    }
  }

  getInrAmount(amountCents: number, paymentId: string): number {
    const amountUSD = amountCents / 100;
    const exchangeRate = this.getExchangeRate(paymentId);
    if (!exchangeRate) return 0;
    return amountUSD * exchangeRate;
  }

  async createInvoice(invoice: PendingUSDInvoice) {
    const exchangeRate = this.getExchangeRate(invoice.payment_id);

    // Validate exchange rate
    if (!exchangeRate || exchangeRate <= 0) {
      const toast = await this.toastController.create({
        message: 'Please enter a valid exchange rate',
        duration: 3000,
        color: 'warning',
      });
      await toast.present();
      return;
    }

    // Confirm before creating
    const alert = await this.alertController.create({
      header: 'Create Invoice',
      message: `Create invoice for ${invoice.user_name} (${
        invoice.user_email
      })?<br><br>
        Amount: $${(invoice.amount_cents / 100).toFixed(2)} USD<br>
        Exchange Rate: ₹${exchangeRate.toFixed(2)}<br>
        INR Amount: ₹${this.getInrAmount(
          invoice.amount_cents,
          invoice.payment_id
        ).toFixed(2)}`,
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel',
        },
        {
          text: 'Create Invoice',
          handler: async () => {
            await this.processInvoiceCreation(invoice, exchangeRate);
          },
        },
      ],
    });

    await alert.present();
  }

  async processInvoiceCreation(
    invoice: PendingUSDInvoice,
    exchangeRate: number
  ) {
    this.processingPaymentIds.add(invoice.payment_id);

    try {
      const result = await this.adminApi.createUSDInvoice({
        paymentId: invoice.payment_id,
        exchangeRate,
      });

      const toast = await this.toastController.create({
        message: `Invoice ${result.invoiceNumber} created successfully!`,
        duration: 3000,
        color: 'success',
      });
      await toast.present();

      // Remove from pending list
      this.pendingInvoices = this.pendingInvoices.filter(
        (inv) => inv.payment_id !== invoice.payment_id
      );

      // Navigate to invoice
      this.router.navigate(['/invoice', result.invoiceId]);
    } catch (error: any) {
      const toast = await this.toastController.create({
        message: error?.error?.error || 'Failed to create invoice',
        duration: 5000,
        color: 'danger',
      });
      await toast.present();
    } finally {
      this.processingPaymentIds.delete(invoice.payment_id);
    }
  }

  isProcessing(paymentId: string): boolean {
    return this.processingPaymentIds.has(paymentId);
  }

  getInvoiceTypeLabel(type: string): string {
    return type === 'season_ticket'
      ? 'Live Coverage Ticket'
      : 'Live Coverage Ticket';
  }

  formatDate(dateString: string): string {
    // The database stores timestamps in UTC
    // Convert UTC to IST by explicitly parsing as UTC and formatting in IST timezone
    const date = new Date(dateString);

    // Format with IST timezone
    return new Intl.DateTimeFormat('en-IN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata',
    }).format(date);
  }
}
