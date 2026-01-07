import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

export interface AdminSubscriptionRow {
  user_id: string;
  user_email: string;
  user_name: string | null;
  user_mobile: string | null;
  user_country: string | null;
  event_id: string;
  event_title: string;
  event_starts_at: string;
  ticket_status: 'pending' | 'paid' | 'none';
  subscribed_at: string | null;
  total_paid_cents: number;
  season_ticket_status: 'pending' | 'paid' | null;
  season_ticket_purchased_at: string | null;
}

export interface PendingUSDInvoice {
  payment_id: string;
  provider_payment_id: string;
  user_id: string;
  event_id: string | null;
  amount_cents: number;
  currency: string;
  created_at: string;
  user_name: string;
  user_email: string;
  event_title: string | null;
  invoice_type: 'event_ticket' | 'season_ticket';
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  mobile?: string;
  role: 'admin' | 'superadmin' | 'finance-admin' | 'content-admin';
  is_active?: boolean;
  created_at: string;
}

@Injectable({
  providedIn: 'root',
})
export class AdminApiService {
  constructor(private http: HttpClient) {}

  async listSubscriptions(): Promise<AdminSubscriptionRow[]> {
    const url = `${environment.apiBaseUrl}/admin/subscriptions`;
    const resp = await firstValueFrom(
      this.http.get<{ subscriptions: AdminSubscriptionRow[] }>(url)
    );
    return resp.subscriptions;
  }

  async setTicketPaid(params: {
    userId: string;
    eventId: string;
    paid: boolean;
    note?: string;
    amountCents?: number;
    currency?: string;
  }): Promise<void> {
    const url = `${environment.apiBaseUrl}/admin/ticket-status`;
    await firstValueFrom(this.http.post(url, params));
  }

  async markPaid(params: {
    eventId: string;
    userEmail: string;
    amountCents?: number;
    currency?: string;
    note?: string;
  }): Promise<void> {
    const url = `${environment.apiBaseUrl}/admin/mark-paid`;
    await firstValueFrom(this.http.post(url, params));
  }

  async deleteSubscription(userId: string, eventId: string): Promise<void> {
    const url = `${environment.apiBaseUrl}/admin/subscription?userId=${userId}&eventId=${eventId}`;
    await firstValueFrom(this.http.delete(url));
  }

  async deleteUser(userId: string): Promise<void> {
    const url = `${environment.apiBaseUrl}/admin/user/${userId}`;
    await firstValueFrom(this.http.delete(url));
  }

  async updateUser(userId: string, data: {
    name?: string;
    email?: string;
    mobile?: string;
    country?: string;
  }): Promise<void> {
    const url = `${environment.apiBaseUrl}/admin/user/${userId}`;
    await firstValueFrom(this.http.put(url, data));
  }

  async deleteEvent(eventId: string): Promise<void> {
    const url = `${environment.apiBaseUrl}/events/${eventId}`;
    await firstValueFrom(this.http.delete(url));
  }

  async setSeasonTicketStatus(userId: string, paid: boolean): Promise<void> {
    const url = `${environment.apiBaseUrl}/admin/season-ticket-status`;
    await firstValueFrom(this.http.post(url, { userId, paid }));
  }

  async listPendingUSDInvoices(): Promise<PendingUSDInvoice[]> {
    const url = `${environment.apiBaseUrl}/invoices/admin/pending-usd`;
    const resp = await firstValueFrom(
      this.http.get<{ payments: PendingUSDInvoice[] }>(url)
    );
    return resp.payments;
  }

  async createUSDInvoice(params: {
    paymentId: string;
    exchangeRate: number;
  }): Promise<{ invoiceId: string; invoiceNumber: string }> {
    const url = `${environment.apiBaseUrl}/invoices/admin/generate-usd-invoice`;
    const resp = await firstValueFrom(
      this.http.post<{
        success: boolean;
        invoice: {
          id: string;
          invoice_number: string;
          usd_amount: number;
          conversion_rate: number;
          inr_amount: number;
          total_paise: number;
        };
      }>(url, { paymentId: params.paymentId, conversionRate: params.exchangeRate })
    );
    return {
      invoiceId: resp.invoice.id,
      invoiceNumber: resp.invoice.invoice_number,
    };
  }

  async listAdminUsers(): Promise<AdminUser[]> {
    const url = `${environment.apiBaseUrl}/admin/users`;
    const resp = await firstValueFrom(
      this.http.get<{ users: AdminUser[] }>(url)
    );
    return resp.users;
  }

  async createAdminUser(
    name: string,
    email: string,
    mobile: string,
    password: string,
    role: 'admin' | 'finance-admin' | 'content-admin'
  ): Promise<AdminUser> {
    const url = `${environment.apiBaseUrl}/admin/users`;
    const resp = await firstValueFrom(
      this.http.post<{ user: AdminUser }>(url, { name, email, mobile, password, role })
    );
    return resp.user;
  }

  async updateUserRole(
    userId: string,
    role: 'admin' | 'finance-admin' | 'content-admin'
  ): Promise<void> {
    const url = `${environment.apiBaseUrl}/admin/users/${userId}/role`;
    await firstValueFrom(
      this.http.put(url, { role })
    );
  }

  async deleteAdminUser(userId: string): Promise<void> {
    const url = `${environment.apiBaseUrl}/admin/users/${userId}`;
    await firstValueFrom(this.http.delete(url));
  }

  async updateAdminUser(userId: string, data: {
    name?: string;
    email?: string;
    mobile?: string;
  }): Promise<void> {
    const url = `${environment.apiBaseUrl}/admin/users/${userId}`;
    await firstValueFrom(this.http.put(url, data));
  }

  async toggleAdminUserStatus(userId: string, isActive: boolean): Promise<void> {
    const url = `${environment.apiBaseUrl}/admin/users/${userId}/status`;
    await firstValueFrom(this.http.put(url, { is_active: isActive }));
  }
}
