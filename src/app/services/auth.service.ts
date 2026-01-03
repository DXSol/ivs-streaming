import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, firstValueFrom, Observable } from 'rxjs';
import { Preferences } from '@capacitor/preferences';
import { environment } from '../../environments/environment';

export type UserRole = 'viewer' | 'admin';

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  name?: string;
  mobile?: string;
  country?: string;
  address?: string;
}

export type User = AuthUser;

interface LoginResponse {
  accessToken: string;
  user: AuthUser;
}

const ACCESS_TOKEN_KEY = 'access_token';
const USER_KEY = 'auth_user';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private initialized = false;
  private accessToken: string | null = null;
  private user: AuthUser | null = null;
  
  // Observable for auth state changes
  private userSubject = new BehaviorSubject<AuthUser | null>(null);
  public user$: Observable<AuthUser | null> = this.userSubject.asObservable();

  constructor(private http: HttpClient) {}

  async init() {
    if (this.initialized) return;

    const [token, user] = await Promise.all([
      Preferences.get({ key: ACCESS_TOKEN_KEY }),
      Preferences.get({ key: USER_KEY }),
    ]);

    this.accessToken = token.value || null;
    this.user = user.value ? (JSON.parse(user.value) as AuthUser) : null;
    this.initialized = true;
    this.userSubject.next(this.user);
  }

  getAccessTokenSync(): string | null {
    return this.accessToken;
  }

  getUserSync(): AuthUser | null {
    return this.user;
  }

  async isLoggedIn(): Promise<boolean> {
    await this.init();
    return !!this.accessToken;
  }

  async login(email: string, password: string): Promise<AuthUser> {
    const base = environment.apiBaseUrl;
    const url = `${base}/auth/login`;

    const resp = await firstValueFrom(
      this.http.post<LoginResponse>(url, { email, password })
    );

    this.accessToken = resp.accessToken;
    this.user = resp.user;
    this.initialized = true;

    await Promise.all([
      Preferences.set({ key: ACCESS_TOKEN_KEY, value: resp.accessToken }),
      Preferences.set({ key: USER_KEY, value: JSON.stringify(resp.user) }),
    ]);

    this.userSubject.next(resp.user);
    return resp.user;
  }

  async register(name: string, email: string, password: string, mobile?: string, country?: string, address?: string): Promise<AuthUser> {
    const base = environment.apiBaseUrl;
    const url = `${base}/auth/register`;

    const resp = await firstValueFrom(
      this.http.post<LoginResponse>(url, { name, email, password, mobile, country, address })
    );

    this.accessToken = resp.accessToken;
    this.user = resp.user;
    this.initialized = true;

    await Promise.all([
      Preferences.set({ key: ACCESS_TOKEN_KEY, value: resp.accessToken }),
      Preferences.set({ key: USER_KEY, value: JSON.stringify(resp.user) }),
    ]);

    this.userSubject.next(resp.user);
    return resp.user;
  }

  async logout() {
    this.accessToken = null;
    this.user = null;
    await Promise.all([
      Preferences.remove({ key: ACCESS_TOKEN_KEY }),
      Preferences.remove({ key: USER_KEY }),
    ]);
    this.userSubject.next(null);
  }

  async updateProfile(data: { name?: string; email?: string; address?: string }): Promise<AuthUser> {
    const base = environment.apiBaseUrl;
    const url = `${base}/auth/profile`;

    const resp = await firstValueFrom(
      this.http.put<{ user: AuthUser }>(url, data)
    );

    this.user = resp.user;
    await Preferences.set({ key: USER_KEY, value: JSON.stringify(resp.user) });

    return resp.user;
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const base = environment.apiBaseUrl;
    const url = `${base}/auth/change-password`;

    await firstValueFrom(
      this.http.put<{ message: string }>(url, { currentPassword, newPassword })
    );
  }

  async getPaymentSummary(): Promise<{ totalPaidPaise: number; totalPaidRupees: number }> {
    const base = environment.apiBaseUrl;
    const url = `${base}/auth/payment-summary`;

    return firstValueFrom(
      this.http.get<{ totalPaidPaise: number; totalPaidRupees: number }>(url)
    );
  }

  async getInvoices(): Promise<{ invoices: Invoice[] }> {
    const base = environment.apiBaseUrl;
    const url = `${base}/invoices`;

    return firstValueFrom(
      this.http.get<{ invoices: Invoice[] }>(url)
    );
  }

  async getInvoice(invoiceId: string): Promise<{ invoice: Invoice }> {
    const base = environment.apiBaseUrl;
    const url = `${base}/invoices/${invoiceId}`;

    return firstValueFrom(
      this.http.get<{ invoice: Invoice }>(url)
    );
  }
}

export interface Invoice {
  id: string;
  invoice_number: string;
  invoice_type: 'event_ticket' | 'season_ticket';
  event_id?: string;
  event_title?: string;
  customer_name: string;
  subtotal_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  total_paise: number;
  currency: string;
  company_name: string;
  company_address: string;
  company_phone?: string;
  company_gstin: string;
  sac_code?: string;
  invoice_date: string;
  created_at: string;
}
