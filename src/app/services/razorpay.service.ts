import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

declare global {
  interface Window {
    Razorpay: any;
  }
}

export interface CreateOrderResponse {
  orderId: string;
  amount: number;
  currency: string;
  keyId: string;
  isInternational?: boolean;
}

export interface EventPriceResponse {
  amount: number;
  currency: string;
  displayPrice: string;
  isInternational: boolean;
}

export interface SeasonTicketPriceResponse {
  originalPaise: number;
  discountedPaise: number;
  discountPercent: number;
  eventCount: number;
}

export interface CreateSeasonOrderResponse {
  orderId: string;
  amount: number;
  currency: string;
  keyId: string;
  originalPaise: number;
  discountedPaise: number;
}

export interface VerifyPendingResponse {
  tickets: Record<string, string>;
  hasSeasonTicket: boolean;
  seasonTicketPurchasedAt: string | null;
  hasPendingPayments: boolean;
}

export interface PaymentResult {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

@Injectable({
  providedIn: 'root',
})
export class RazorpayService {
  private razorpayKeyId: string | null = null;

  constructor(private http: HttpClient) {}

  async loadScript(): Promise<void> {
    if (window.Razorpay) return;

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load Razorpay SDK'));
      document.body.appendChild(script);
    });
  }

  async getKeyId(): Promise<string> {
    if (this.razorpayKeyId) return this.razorpayKeyId;

    const url = `${environment.apiBaseUrl}/razorpay/key`;
    const resp = await firstValueFrom(this.http.get<{ keyId: string }>(url));
    this.razorpayKeyId = resp.keyId;
    return resp.keyId;
  }

  async getEventPrice(eventId: string): Promise<EventPriceResponse> {
    const url = `${environment.apiBaseUrl}/razorpay/event-price/${eventId}`;
    return await firstValueFrom(this.http.get<EventPriceResponse>(url));
  }

  async createOrder(eventId: string): Promise<CreateOrderResponse> {
    const url = `${environment.apiBaseUrl}/razorpay/create-order`;
    return await firstValueFrom(
      this.http.post<CreateOrderResponse>(url, { eventId })
    );
  }

  async verifyPayment(
    paymentResult: PaymentResult,
    eventId: string,
    amount: number,
    currency: string
  ): Promise<{ success: boolean; message: string }> {
    const url = `${environment.apiBaseUrl}/razorpay/verify-payment`;
    return await firstValueFrom(
      this.http.post<{ success: boolean; message: string }>(url, {
        ...paymentResult,
        eventId,
        amount,
        currency,
      })
    );
  }

  async getSeasonTicketPrice(): Promise<SeasonTicketPriceResponse> {
    const url = `${environment.apiBaseUrl}/razorpay/season-ticket-price`;
    return await firstValueFrom(this.http.get<SeasonTicketPriceResponse>(url));
  }

  async createSeasonOrder(): Promise<CreateSeasonOrderResponse> {
    const url = `${environment.apiBaseUrl}/razorpay/create-season-order`;
    return await firstValueFrom(this.http.post<CreateSeasonOrderResponse>(url, {}));
  }

  async verifySeasonPayment(
    paymentResult: PaymentResult,
    amountPaise: number
  ): Promise<{ success: boolean; message: string }> {
    const url = `${environment.apiBaseUrl}/razorpay/verify-season-payment`;
    return await firstValueFrom(
      this.http.post<{ success: boolean; message: string }>(url, {
        ...paymentResult,
        amountPaise,
      })
    );
  }

  async verifyPendingPayments(): Promise<VerifyPendingResponse> {
    const url = `${environment.apiBaseUrl}/razorpay/verify-pending`;
    return await firstValueFrom(this.http.get<VerifyPendingResponse>(url));
  }

  openPaymentModal(options: {
    orderId: string;
    amount: number;
    currency: string;
    name: string;
    description: string;
    prefillEmail?: string;
    prefillContact?: string;
  }): Promise<PaymentResult> {
    return new Promise(async (resolve, reject) => {
      await this.loadScript();
      const keyId = await this.getKeyId();

      const razorpayOptions = {
        key: keyId,
        amount: options.amount,
        currency: options.currency,
        name: options.name,
        description: options.description,
        order_id: options.orderId,
        prefill: {
          email: options.prefillEmail || '',
          contact: options.prefillContact || '',
        },
        theme: {
          color: '#8B1538',
        },
        handler: (response: PaymentResult) => {
          resolve(response);
        },
        modal: {
          ondismiss: () => {
            reject(new Error('Payment cancelled by user'));
          },
        },
      };

      const rzp = new window.Razorpay(razorpayOptions);
      rzp.on('payment.failed', (response: any) => {
        reject(new Error(response.error?.description || 'Payment failed'));
      });
      rzp.open();
    });
  }
}
