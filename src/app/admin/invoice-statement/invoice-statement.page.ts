import { Component, OnInit } from '@angular/core';
import { ViewWillEnter } from '@ionic/angular/standalone';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
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
  IonItem,
  IonLabel,
  IonSelect,
  IonSelectOption,
  IonInput,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { downloadOutline, printOutline, filterOutline, refreshOutline } from 'ionicons/icons';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';

interface InvoiceStatement {
  id: string;
  invoice_number: string;
  invoice_date: string;
  invoice_type: string;
  event_id: string | null;
  customer_name: string;
  subtotal_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  total_paise: number;
  currency: string;
  event_title: string | null;
  razorpay_payment_id: string | null;
}

interface StatementTotals {
  subtotal_paise: number;
  gst_paise: number;
  total_paise: number;
  count: number;
}

interface Event {
  id: string;
  title: string;
}

@Component({
  selector: 'app-invoice-statement',
  templateUrl: './invoice-statement.page.html',
  styleUrls: ['./invoice-statement.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    IonContent,
    IonHeader,
    IonTitle,
    IonToolbar,
    IonButtons,
    IonBackButton,
    IonButton,
    IonIcon,
    IonSpinner,
    IonItem,
    IonLabel,
    IonSelect,
    IonSelectOption,
    IonInput,
  ]
})
export class InvoiceStatementPage implements OnInit, ViewWillEnter {
  invoices: InvoiceStatement[] = [];
  totals: StatementTotals = { subtotal_paise: 0, gst_paise: 0, total_paise: 0, count: 0 };
  events: Event[] = [];
  isLoading = false;
  
  // Filters
  startDate = '';
  endDate = '';
  selectedEventId = '';
  
  // For print header
  currentDate = new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' });

  constructor(private http: HttpClient, private router: Router) {
    addIcons({ downloadOutline, printOutline, filterOutline, refreshOutline });
  }

  async ngOnInit() {
    await this.loadEvents();
    await this.loadStatement();
  }

  async ionViewWillEnter() {
    // Reload data when navigating to this page
    await this.loadStatement();
  }

  async loadEvents() {
    try {
      const res = await firstValueFrom(
        this.http.get<{ events: Event[] }>(`${environment.apiBaseUrl}/events`)
      );
      this.events = res.events || [];
    } catch (err) {
      console.error('Failed to load events:', err);
    }
  }

  async loadStatement() {
    this.isLoading = true;
    try {
      let url = `${environment.apiBaseUrl}/invoices/admin/statement`;
      const params: string[] = [];
      
      if (this.startDate) params.push(`startDate=${this.startDate}`);
      if (this.endDate) params.push(`endDate=${this.endDate}`);
      if (this.selectedEventId) params.push(`eventId=${this.selectedEventId}`);
      
      if (params.length > 0) url += '?' + params.join('&');
      
      const res = await firstValueFrom(
        this.http.get<{ invoices: InvoiceStatement[]; totals: StatementTotals }>(url)
      );
      this.invoices = res.invoices || [];
      this.totals = res.totals || { subtotal_paise: 0, gst_paise: 0, total_paise: 0, count: 0 };
    } catch (err) {
      console.error('Failed to load statement:', err);
    } finally {
      this.isLoading = false;
    }
  }

  applyFilters() {
    this.loadStatement();
  }

  clearFilters() {
    this.startDate = '';
    this.endDate = '';
    this.selectedEventId = '';
    this.loadStatement();
  }

  formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  getEventName(invoice: InvoiceStatement): string {
    if (invoice.invoice_type === 'season_ticket') return 'Season Ticket';
    return invoice.event_title || 'N/A';
  }

  getGst(invoice: InvoiceStatement): number {
    return invoice.cgst_paise + invoice.sgst_paise + invoice.igst_paise;
  }

  async downloadCsv() {
    try {
      let url = `${environment.apiBaseUrl}/invoices/admin/export`;
      const params: string[] = [];
      
      if (this.startDate) params.push(`startDate=${this.startDate}`);
      if (this.endDate) params.push(`endDate=${this.endDate}`);
      if (this.selectedEventId) params.push(`eventId=${this.selectedEventId}`);
      
      if (params.length > 0) url += '?' + params.join('&');
      
      const res = await firstValueFrom(
        this.http.get(url, { responseType: 'blob' })
      );
      
      const blob = new Blob([res], { type: 'text/csv' });
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `invoice-statement-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      console.error('Failed to download CSV:', err);
    }
  }

  printStatement() {
    window.print();
  }

  viewInvoice(invoiceId: string) {
    this.router.navigate(['/invoice', invoiceId], {
      queryParams: { returnUrl: '/admin/invoice-statement' }
    });
  }
}
