import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
  IonButtons,
  IonBackButton,
  IonButton,
  IonIcon,
  IonSpinner,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { printOutline, arrowBackOutline, documentOutline } from 'ionicons/icons';

import { AuthService, Invoice } from '../services/auth.service';
import { environment } from '../../environments/environment';

@Component({
  selector: 'app-invoice',
  templateUrl: './invoice.page.html',
  styleUrls: ['./invoice.page.scss'],
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
    IonIcon,
    IonSpinner,
  ]
})
export class InvoicePage implements OnInit {
  invoice: Invoice | null = null;
  isLoading = true;
  errorMessage = '';
  returnUrl: string = '/events';
  isNewFormat = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private auth: AuthService
  ) {
    addIcons({ printOutline, arrowBackOutline, documentOutline });
  }

  async ngOnInit() {
    const invoiceId = this.route.snapshot.paramMap.get('id');
    
    // Get return URL from query params (defaults to /events)
    this.returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') || '/events';
    
    if (!invoiceId) {
      this.errorMessage = 'Invoice ID not provided';
      this.isLoading = false;
      return;
    }

    try {
      const result = await this.auth.getInvoice(invoiceId);
      this.invoice = result.invoice;
      // Check if invoice uses new format (YYYYMMH-serial) - starts with year 2026+
      this.isNewFormat = this.invoice?.invoice_number?.startsWith('2026') || false;
    } catch (err: any) {
      this.errorMessage = 'Failed to load invoice';
      console.error('Failed to load invoice:', err);
    } finally {
      this.isLoading = false;
    }
  }

  getInvoiceTypeLabel(type: string): string {
    return type === 'season_ticket' ? 'Season Ticket' : 'Event Ticket';
  }

  formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }

  printInvoice() {
    window.print();
  }

  async downloadPdf() {
    if (!this.invoice) return;

    try {
      const token = this.auth.getAccessTokenSync();
      if (!token) {
        alert('Please log in to download the invoice.');
        return;
      }

      const invoiceId = this.invoice.id;

      // Fetch PDF as blob
      const response = await fetch(`${environment.apiBaseUrl}/invoices/${invoiceId}/pdf`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to download PDF');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Invoice-${this.invoice.invoice_number}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to download PDF:', err);
      alert('Failed to download PDF. Please try again.');
    }
  }

  goBack() {
    this.router.navigate([this.returnUrl]);
  }

  numberToWords(num: number): string {
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
      'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

    if (num === 0) return 'Zero';

    const convertLessThanThousand = (n: number): string => {
      if (n === 0) return '';
      if (n < 20) return ones[n];
      if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
      return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + convertLessThanThousand(n % 100) : '');
    };

    // Indian numbering system: Crore, Lakh, Thousand, Hundred
    let result = '';
    const crore = Math.floor(num / 10000000);
    const lakh = Math.floor((num % 10000000) / 100000);
    const thousand = Math.floor((num % 100000) / 1000);
    const remainder = num % 1000;

    if (crore > 0) {
      result += convertLessThanThousand(crore) + ' Crore ';
    }
    if (lakh > 0) {
      result += convertLessThanThousand(lakh) + ' Lakh ';
    }
    if (thousand > 0) {
      result += convertLessThanThousand(thousand) + ' Thousand ';
    }
    if (remainder > 0) {
      result += convertLessThanThousand(remainder);
    }

    return result.trim();
  }

  getRoundingAdjustment(): string {
    if (!this.invoice) return '0.00';

    // Calculate what the total should be based on subtotal + taxes
    const calculatedTotal = this.invoice.subtotal_paise + this.invoice.cgst_paise + this.invoice.sgst_paise;

    // Rounding adjustment is the difference
    const adjustment = this.invoice.total_paise - calculatedTotal;

    // Format as currency with sign
    const adjustmentRupees = adjustment / 100;
    return adjustmentRupees >= 0
      ? `(+)${adjustmentRupees.toFixed(2)}`
      : `(-)${Math.abs(adjustmentRupees).toFixed(2)}`;
  }

  getAmountInWords(): string {
    if (!this.invoice) return '';
    const rupees = Math.floor(this.invoice.total_paise / 100);
    const paise = this.invoice.total_paise % 100;

    let result = 'Rupees ' + this.numberToWords(rupees);
    if (paise > 0) {
      result += ' and ' + this.numberToWords(paise) + ' Paise';
    }
    result += ' Only';
    return result;
  }
}
