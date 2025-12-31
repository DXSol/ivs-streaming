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
import { printOutline, arrowBackOutline } from 'ionicons/icons';

import { AuthService, Invoice } from '../services/auth.service';

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

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private auth: AuthService
  ) {
    addIcons({ printOutline, arrowBackOutline });
  }

  async ngOnInit() {
    const invoiceId = this.route.snapshot.paramMap.get('id');
    if (!invoiceId) {
      this.errorMessage = 'Invoice ID not provided';
      this.isLoading = false;
      return;
    }

    try {
      const result = await this.auth.getInvoice(invoiceId);
      this.invoice = result.invoice;
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

  goBack() {
    this.router.navigate(['/profile']);
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
