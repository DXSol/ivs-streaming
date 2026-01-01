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
}
