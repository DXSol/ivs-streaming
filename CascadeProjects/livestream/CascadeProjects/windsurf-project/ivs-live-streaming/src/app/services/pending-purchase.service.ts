import { Injectable } from '@angular/core';

export interface PendingPurchase {
  type: 'ticket' | 'season';
  eventId?: string;
  eventTitle?: string;
}

const PENDING_PURCHASE_KEY = 'pending_purchase';

@Injectable({
  providedIn: 'root',
})
export class PendingPurchaseService {
  setPendingPurchase(purchase: PendingPurchase): void {
    localStorage.setItem(PENDING_PURCHASE_KEY, JSON.stringify(purchase));
  }

  getPendingPurchase(): PendingPurchase | null {
    const stored = localStorage.getItem(PENDING_PURCHASE_KEY);
    if (!stored) return null;
    try {
      return JSON.parse(stored) as PendingPurchase;
    } catch {
      return null;
    }
  }

  clearPendingPurchase(): void {
    localStorage.removeItem(PENDING_PURCHASE_KEY);
  }

  hasPendingPurchase(): boolean {
    return localStorage.getItem(PENDING_PURCHASE_KEY) !== null;
  }
}
