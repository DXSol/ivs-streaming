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
  IonSegment,
  IonSegmentButton,
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
  company_name: string;
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
    IonSegment,
    IonSegmentButton,
  ]
})
export class InvoiceStatementPage implements OnInit, ViewWillEnter {
  allInvoices: InvoiceStatement[] = [];
  invoices: InvoiceStatement[] = [];
  totals: StatementTotals = { subtotal_paise: 0, gst_paise: 0, total_paise: 0, count: 0 };
  events: Event[] = [];
  isLoading = false;

  // Company tabs
  selectedCompany: 'all' | 'dx' | 'hope' = 'all';

  // Filters
  startDate = '';
  endDate = '';
  selectedEventId = '';

  // Sorting
  sortColumn: string = 'invoice_date';
  sortDirection: 'asc' | 'desc' = 'desc';

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
      this.allInvoices = res.invoices || [];

      // Filter by company
      this.filterByCompany();
    } catch (err) {
      console.error('Failed to load statement:', err);
    } finally {
      this.isLoading = false;
    }
  }

  onCompanyChange(event: any) {
    this.selectedCompany = event.detail.value;
    this.filterByCompany();
  }

  filterByCompany() {
    let filtered = this.allInvoices;

    if (this.selectedCompany === 'dx') {
      filtered = this.allInvoices.filter(inv => inv.company_name === 'DX Solutions');
    } else if (this.selectedCompany === 'hope') {
      // Match any company name that contains "Hope"
      filtered = this.allInvoices.filter(inv =>
        inv.company_name && inv.company_name.toLowerCase().includes('hope')
      );
    }

    this.invoices = filtered;

    // Recalculate totals for filtered invoices
    this.totals = this.invoices.reduce(
      (acc, inv) => {
        acc.subtotal_paise += inv.subtotal_paise;
        acc.gst_paise += inv.cgst_paise + inv.sgst_paise + inv.igst_paise;
        acc.total_paise += inv.total_paise;
        acc.count++;
        return acc;
      },
      { subtotal_paise: 0, gst_paise: 0, total_paise: 0, count: 0 }
    );

    // Apply sorting
    this.sortInvoices();
  }

  sortBy(column: string) {
    if (this.sortColumn === column) {
      // Toggle direction if same column
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      // New column, default to descending for dates and amounts, ascending for text
      this.sortColumn = column;
      this.sortDirection = ['invoice_date', 'subtotal_paise', 'total_paise'].includes(column) ? 'desc' : 'asc';
    }
    this.sortInvoices();
  }

  sortInvoices() {
    this.invoices.sort((a, b) => {
      let aVal: any;
      let bVal: any;

      switch (this.sortColumn) {
        case 'invoice_number':
          aVal = a.invoice_number;
          bVal = b.invoice_number;
          break;
        case 'invoice_date':
          aVal = new Date(a.invoice_date).getTime();
          bVal = new Date(b.invoice_date).getTime();
          break;
        case 'customer_name':
          aVal = (a.customer_name || '').toLowerCase();
          bVal = (b.customer_name || '').toLowerCase();
          break;
        case 'event_name':
          aVal = this.getEventName(a).toLowerCase();
          bVal = this.getEventName(b).toLowerCase();
          break;
        case 'subtotal_paise':
          aVal = a.subtotal_paise;
          bVal = b.subtotal_paise;
          break;
        case 'gst':
          aVal = this.getGst(a);
          bVal = this.getGst(b);
          break;
        case 'total_paise':
          aVal = a.total_paise;
          bVal = b.total_paise;
          break;
        default:
          return 0;
      }

      if (aVal < bVal) return this.sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return this.sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
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
