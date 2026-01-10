import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule, NgFor, NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  IonButton,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonTitle,
  IonToolbar,
  IonSpinner,
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonCardContent,
  IonButtons,
  IonMenuButton,
  IonIcon,
  IonSegment,
  IonSegmentButton,
  ViewWillEnter,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  ticketOutline, calendarOutline, checkmarkCircleOutline, musicalNotesOutline,
  createOutline, playCircleOutline, logOutOutline, menuOutline, videocamOutline,
  cartOutline, starOutline, checkmarkCircle, personCircleOutline, trashOutline,
  callOutline
} from 'ionicons/icons';
import { AlertController, ModalController } from '@ionic/angular/standalone';

import { EventsApiService, EventDto } from '../services/events-api.service';
import { AuthService } from '../services/auth.service';
import { RazorpayService, SeasonTicketPriceResponse } from '../services/razorpay.service';
import { FooterComponent } from '../shared/footer/footer.component';
import { AdminApiService } from '../services/admin-api.service';
import { PendingPurchaseService } from '../services/pending-purchase.service';
import { EventTimePipe } from '../pipes/event-time.pipe';
import { ContactInfoComponent } from '../shared/contact-info/contact-info.component';
import { environment } from '../../environments/environment';

@Component({
  selector: 'app-events',
  templateUrl: './events.page.html',
  styleUrls: ['./events.page.scss'],
  imports: [
    CommonModule,
    FormsModule,
    NgIf,
    NgFor,
    RouterLink,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonList,
    IonItem,
    IonLabel,
    IonButton,
    IonSpinner,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardContent,
    IonButtons,
    IonMenuButton,
    IonIcon,
    IonSegment,
    IonSegmentButton,
    FooterComponent,
    EventTimePipe,
  ],
})
export class EventsPage implements OnInit, OnDestroy, ViewWillEnter {
  isLoading = true;
  errorMessage = '';
  events: EventDto[] = [];
  selectedTab: 'paid' | 'free' | 'free-short' = 'paid';
  isAdmin = false;
  isLoggedIn = false;
  
  // Season ticket
  seasonTicketPrice: SeasonTicketPriceResponse | null = null;
  hasSeasonTicket = false;
  seasonTicketPurchasedAt: string | null = null;
  isProcessingSeasonPayment = false;

  // Event ticket status - maps eventId to ticket status
  eventTicketStatus: Map<string, { hasPaid: boolean; isProcessing: boolean }> = new Map();

  // Live stream status for each event
  eventLiveStatus: Map<string, boolean> = new Map();

  // Recording expiry info from backend (per-user)
  recordingExpiryInfo: Map<string, { expiresAt: Date; isExpired: boolean }> = new Map();

  // Timer for auto-polling live stream status
  private liveStatusTimer?: any;

  constructor(
    private eventsApi: EventsApiService,
    private auth: AuthService,
    private razorpay: RazorpayService,
    private cdr: ChangeDetectorRef,
    private alertController: AlertController,
    private adminApi: AdminApiService,
    private pendingPurchase: PendingPurchaseService,
    private router: Router,
    private modalController: ModalController
  ) {
    addIcons({
      ticketOutline, calendarOutline, checkmarkCircleOutline, musicalNotesOutline,
      createOutline, playCircleOutline, logOutOutline, menuOutline, videocamOutline,
      cartOutline, starOutline, checkmarkCircle, personCircleOutline, trashOutline,
      callOutline
    });
  }

  async ngOnInit() {
    await this.load();
  }

  async ionViewWillEnter() {
    await this.auth.init();
    const user = this.auth.getUserSync();
    this.isLoggedIn = !!user;
    const adminRoles = ['admin', 'superadmin', 'finance-admin', 'content-admin'];
    this.isAdmin = user?.role ? adminRoles.includes(user.role) : false;
    this.cdr.detectChanges();
    
    // Reload events list every time the page is entered
    await this.load();

    if (this.isLoggedIn) {
      await this.loadSeasonTicketPrice();
      await this.loadUserTicketStatus();
      await this.loadRecordingExpiryInfo();
      // Check for any pending payments that may have completed via webhook
      await this.verifyPendingPayments();
    }
    await this.checkLiveStreamStatuses();
    this.startLiveStatusPolling();
  }

  ngOnDestroy() {
    if (this.liveStatusTimer) {
      clearInterval(this.liveStatusTimer);
      this.liveStatusTimer = undefined;
    }
  }

  private startLiveStatusPolling() {
    // Poll every 10 seconds for live stream status updates
    this.liveStatusTimer = setInterval(async () => {
      await this.checkLiveStreamStatuses();
    }, 10000);
  }

  async load() {
    this.isLoading = true;
    this.errorMessage = '';

    try {
      this.events = await this.eventsApi.listEvents();
    } catch (e: any) {
      this.errorMessage = e?.message || 'Failed to load events';
    } finally {
      this.isLoading = false;
    }
  }

  async logout() {
    await this.auth.logout();
    window.location.href = '/login';
  }

  async loadSeasonTicketPrice() {
    try {
      this.seasonTicketPrice = await this.razorpay.getSeasonTicketPrice();
    } catch {
      // Silently fail
    }
  }

  async loadUserTicketStatus() {
    try {
      const status = await this.eventsApi.getUserTicketStatus();
      this.hasSeasonTicket = status.hasSeasonTicket;
      this.seasonTicketPurchasedAt = status.seasonTicketPurchasedAt;

      // Set individual ticket statuses
      for (const [eventId, ticketStatus] of Object.entries(status.tickets)) {
        this.eventTicketStatus.set(eventId, {
          hasPaid: ticketStatus === 'paid',
          isProcessing: false
        });
      }

      this.cdr.detectChanges();
    } catch {
      // Silently fail - user might not be logged in
    }
  }

  async loadRecordingExpiryInfo() {
    try {
      const response = await this.eventsApi.getRecordingExpiryInfo();

      // Clear previous data
      this.recordingExpiryInfo.clear();

      // Store the expiry info
      for (const [eventId, info] of Object.entries(response.expiryInfo)) {
        this.recordingExpiryInfo.set(eventId, {
          expiresAt: new Date(info.expiresAt),
          isExpired: info.isExpired
        });
      }

      this.cdr.detectChanges();
    } catch {
      // Silently fail - user might not be logged in
    }
  }

  async verifyPendingPayments() {
    try {
      const result = await this.razorpay.verifyPendingPayments();
      
      // Update ticket status from verification result
      this.hasSeasonTicket = result.hasSeasonTicket;
      this.seasonTicketPurchasedAt = result.seasonTicketPurchasedAt;
      
      // Update individual ticket statuses
      for (const [eventId, ticketStatus] of Object.entries(result.tickets)) {
        this.eventTicketStatus.set(eventId, { 
          hasPaid: ticketStatus === 'paid', 
          isProcessing: false 
        });
      }
      
      this.cdr.detectChanges();
    } catch {
      // Silently fail - this is a background check
    }
  }

  async buySeasonTicket() {
    if (!this.seasonTicketPrice) return;

    // If not logged in, redirect to register with pending purchase
    if (!this.isLoggedIn) {
      this.pendingPurchase.setPendingPurchase({ type: 'season' });
      this.router.navigate(['/register']);
      return;
    }

    this.isProcessingSeasonPayment = true;
    this.errorMessage = '';

    try {
      const order = await this.razorpay.createSeasonOrder();
      const user = this.auth.getUserSync();

      const paymentResult = await this.razorpay.openPaymentModal({
        orderId: order.orderId,
        amount: order.amount,
        currency: order.currency,
        name: 'Sankeertanotsav 2026',
        description: 'Season Ticket - Access to all events',
        prefillEmail: user?.email,
      });

      const verifyResult = await this.razorpay.verifySeasonPayment(paymentResult, order.discountedAmount, order.currency);

      // Reload recording expiry info after successful payment
      await this.loadRecordingExpiryInfo();

      // Navigate to invoice if available
      if (verifyResult.invoiceId) {
        this.router.navigate(['/invoice', verifyResult.invoiceId], {
          queryParams: { returnUrl: '/events' },
          replaceUrl: true
        });
        return;
      }

      // Fallback if no invoice
      this.hasSeasonTicket = true;
      this.seasonTicketPurchasedAt = new Date().toISOString();
      // Reload ticket status to get accurate data
      await this.loadUserTicketStatus();
    } catch (e: any) {
      if (e?.message !== 'Payment cancelled by user') {
        this.errorMessage = e?.error?.error || e?.message || 'Payment failed';
      }
    } finally {
      this.isProcessingSeasonPayment = false;
    }
  }

  // Check if event is covered by season ticket (event started after season ticket purchase)
  isEventCoveredBySeasonTicket(event: EventDto): boolean {
    if (!this.hasSeasonTicket || !this.seasonTicketPurchasedAt) return false;
    return new Date(event.starts_at) >= new Date(this.seasonTicketPurchasedAt);
  }

  // Check if user has paid access to this event (admin OR individual ticket OR covered by season ticket)
  hasAccessToEvent(event: EventDto): boolean {
    // Admin has unrestricted access to all events
    if (this.isAdmin) return true;
    const ticketStatus = this.eventTicketStatus.get(event.id);
    if (ticketStatus?.hasPaid) return true;
    return this.isEventCoveredBySeasonTicket(event);
  }

  getTicketStatus(eventId: string): { hasPaid: boolean; isProcessing: boolean } {
    return this.eventTicketStatus.get(eventId) || { hasPaid: false, isProcessing: false };
  }

  shouldShowSeasonTicketBanner(): boolean {
    return environment.showSeasonTicketBanner && this.hasValidSeasonTicketAmount();
  }

  hasValidSeasonTicketAmount(): boolean {
    if (!this.seasonTicketPrice) return false;

    // Check if there's a valid amount based on currency
    if (this.seasonTicketPrice.currency === 'INR') {
      return (this.seasonTicketPrice.discountedPaise || 0) > 0;
    } else {
      return (this.seasonTicketPrice.discountedCents || 0) > 0;
    }
  }

  getOriginalPrice(): string {
    if (!this.seasonTicketPrice) return '';

    if (this.seasonTicketPrice.currency === 'INR') {
      return `₹${((this.seasonTicketPrice.originalPaise || 0) / 100).toFixed(0)}`;
    } else {
      return `$${((this.seasonTicketPrice.originalCents || 0) / 100).toFixed(2)}`;
    }
  }

  getEventPrice(event: EventDto): string {
    // Check if user is international based on season ticket price response
    if (this.seasonTicketPrice && this.seasonTicketPrice.isInternational) {
      return '$10';
    }
    // Default to INR for Indian users
    return `₹${((event.price_paise || 50000) / 100)}`;
  }

  get paidEvents(): EventDto[] {
    return this.events.filter(e => e.event_type === 'paid' || !e.event_type);
  }

  get freeEvents(): EventDto[] {
    return this.events.filter(e => e.event_type === 'free');
  }

  get freeShortEvents(): EventDto[] {
    return this.events.filter(e => e.event_type === 'free-short');
  }

  // Count of concerts covered by the user's season ticket
  get seasonTicketConcertCount(): number {
    if (!this.hasSeasonTicket || !this.seasonTicketPurchasedAt) return 0;
    const purchaseDate = new Date(this.seasonTicketPurchasedAt);
    return this.paidEvents.filter(e => new Date(e.starts_at) >= purchaseDate).length;
  }

  get upcomingEvents(): EventDto[] {
    const nowMs = Date.now();
    let filtered: EventDto[];
    if (this.selectedTab === 'paid') {
      filtered = this.paidEvents;
    } else if (this.selectedTab === 'free') {
      filtered = this.freeEvents;
    } else {
      filtered = this.freeShortEvents;
    }
    return filtered
      .filter(e => new Date(e.ends_at).getTime() >= nowMs)
      .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
  }

  get pastEvents(): EventDto[] {
    const nowMs = Date.now();
    let filtered: EventDto[];
    if (this.selectedTab === 'paid') {
      filtered = this.paidEvents;
    } else if (this.selectedTab === 'free') {
      filtered = this.freeEvents;
    } else {
      filtered = this.freeShortEvents;
    }
    return filtered
      .filter(e => new Date(e.ends_at).getTime() < nowMs)
      .sort((a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime());
  }

  isPastEvent(event: EventDto): boolean {
    return new Date(event.ends_at).getTime() < Date.now();
  }

  canPurchasePastEvent(event: EventDto): boolean {
    // Must be a paid event
    if (event.event_type !== 'paid') {
      return false;
    }

    // Must have allow_past_purchase enabled
    if (!event.allow_past_purchase) {
      return false;
    }

    // Event must have ended
    if (!this.isPastEvent(event)) {
      return false;
    }

    // User must not already have access
    if (this.hasAccessToEvent(event)) {
      return false;
    }

    // Don't check isRecordingExpired here because:
    // 1. User hasn't purchased, so there's no per-user expiry to check
    // 2. When they purchase, they get 3 days from purchase date
    // 3. Recording will be available as long as it exists in S3
    // The backend will handle any actual availability issues when they try to watch

    return true;
  }

  isEventLive(event: EventDto): boolean {
    // Check if the IVS stream is actually broadcasting
    return this.eventLiveStatus.get(event.id) === true;
  }

  isEventInTimeWindow(event: EventDto): boolean {
    const nowMs = Date.now();
    const startsAtMs = new Date(event.starts_at).getTime();
    const endsAtMs = new Date(event.ends_at).getTime();
    return nowMs >= startsAtMs && nowMs <= endsAtMs;
  }

  isStreamActuallyLive(event: EventDto): boolean {
    return this.eventLiveStatus.get(event.id) === true;
  }

  async checkLiveStreamStatuses() {
    // Only check paid events that are within their time window
    const nowMs = Date.now();
    
    const potentiallyLiveEvents = this.paidEvents.filter(e => {
      const startsAtMs = new Date(e.starts_at).getTime();
      const endsAtMs = new Date(e.ends_at).getTime();
      const inWindow = nowMs >= startsAtMs && nowMs <= endsAtMs;
      return inWindow;
    });

    // Check stream status for each potentially live event
    for (const event of potentiallyLiveEvents) {
      try {
        const status = await this.eventsApi.getStreamStatus(event.id);
        this.eventLiveStatus.set(event.id, status.isLive);
      } catch (err) {
        this.eventLiveStatus.set(event.id, false);
      }
    }
  }

  isRecordingAvailable(event: EventDto): boolean {
    const endsAtMs = new Date(event.ends_at).getTime();
    const nowMs = Date.now();

    // Event must have ended
    if (nowMs < endsAtMs) return false;

    // For recording-only events, add the recording_available_hours delay
    const availableHours = event.recording_available_hours || 0;
    const availableAtMs = endsAtMs + (availableHours * 60 * 60 * 1000);
    if (nowMs < availableAtMs) return false;

    // Recording is available (expiry is checked separately with isRecordingExpired)
    return true;
  }

  getRecordingExpiryDate(event: EventDto): Date {
    // Use backend expiry data if available (per-user based on payment date)
    const expiryInfo = this.recordingExpiryInfo.get(event.id);
    if (expiryInfo) {
      return expiryInfo.expiresAt;
    }

    // Fallback to frontend calculation if backend data not available
    const endsAt = new Date(event.ends_at);
    // Add recording_available_hours delay before calculating expiry
    const availableHours = event.recording_available_hours || 0;
    const availableAtMs = endsAt.getTime() + (availableHours * 60 * 60 * 1000);
    // Add 3 days (72 hours) in milliseconds
    const expiryMs = availableAtMs + (3 * 24 * 60 * 60 * 1000);
    return new Date(expiryMs);
  }

  getRecordingTimeRemaining(event: EventDto): string {
    const expiryDate = this.getRecordingExpiryDate(event);
    const now = new Date();
    const diffMs = expiryDate.getTime() - now.getTime();
    
    if (diffMs <= 0) return 'Expired';
    
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);
    const remainingHours = diffHours % 24;
    
    if (diffDays > 0) {
      return `${diffDays}d ${remainingHours}h left`;
    }
    return `${diffHours}h left`;
  }

  isRecordingExpired(event: EventDto): boolean {
    // Use backend expiry data if available (per-user based on payment date)
    const expiryInfo = this.recordingExpiryInfo.get(event.id);
    if (expiryInfo) {
      return expiryInfo.isExpired;
    }

    // Fallback to frontend calculation if backend data not available
    // (e.g., user not logged in or doesn't have access)
    const endsAtMs = new Date(event.ends_at).getTime();
    const nowMs = Date.now();

    // Event must have ended
    if (nowMs < endsAtMs) return false;

    // Add recording_available_hours delay before calculating expiry
    const availableHours = event.recording_available_hours || 0;
    const availableAtMs = endsAtMs + (availableHours * 60 * 60 * 1000);

    // Check if recording has expired (72 hours = 3 days * 24 hours * 60 min * 60 sec * 1000 ms after it becomes available)
    const expiryMs = availableAtMs + (3 * 24 * 60 * 60 * 1000);

    return nowMs > expiryMs;
  }

  async buyEventTicket(event: EventDto, $event: Event) {
    $event.stopPropagation();
    $event.preventDefault();

    // If not logged in, redirect to register with pending purchase
    if (!this.isLoggedIn) {
      this.pendingPurchase.setPendingPurchase({ 
        type: 'ticket', 
        eventId: event.id,
        eventTitle: event.title 
      });
      this.router.navigate(['/register']);
      return;
    }

    const status = this.eventTicketStatus.get(event.id);
    if (status?.hasPaid || status?.isProcessing) return;

    this.eventTicketStatus.set(event.id, { hasPaid: false, isProcessing: true });
    this.errorMessage = '';

    try {
      // Create order - backend determines price based on user's country
      const order = await this.razorpay.createOrder(event.id);
      const user = this.auth.getUserSync();

      const paymentResult = await this.razorpay.openPaymentModal({
        orderId: order.orderId,
        amount: order.amount,
        currency: order.currency,
        name: 'Sankeertanotsav 2026',
        description: `Ticket for ${event.title}`,
        prefillEmail: user?.email,
      });

      const verifyResult = await this.razorpay.verifyPayment(paymentResult, event.id, order.amount, order.currency);
      this.eventTicketStatus.set(event.id, { hasPaid: true, isProcessing: false });

      // Reload recording expiry info after successful payment
      await this.loadRecordingExpiryInfo();

      // Navigate to invoice if available
      if (verifyResult.invoiceId) {
        this.router.navigate(['/invoice', verifyResult.invoiceId], {
          queryParams: { returnUrl: '/events' },
          replaceUrl: true
        });
        return;
      }
    } catch (e: any) {
      this.eventTicketStatus.set(event.id, { hasPaid: false, isProcessing: false });
      if (e?.message !== 'Payment cancelled by user') {
        this.errorMessage = e?.error?.error || e?.message || 'Payment failed';
      }
    }
  }

  async confirmDeleteEvent(event: EventDto, clickEvent: Event) {
    clickEvent.stopPropagation();

    const alert = await this.alertController.create({
      header: 'Delete Event',
      message: `Are you sure you want to delete "${event.title}"? This will also remove all tickets, payments, and comments associated with this event.`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: () => this.deleteEvent(event),
        },
      ],
    });

    await alert.present();
  }

  async deleteEvent(event: EventDto) {
    try {
      await this.adminApi.deleteEvent(event.id);
      this.events = this.events.filter(e => e.id !== event.id);
    } catch (e: any) {
      this.errorMessage = e?.error?.error || e?.message || 'Failed to delete event';
    }
  }

  async openContactInfo() {
    const modal = await this.modalController.create({
      component: ContactInfoComponent,
      cssClass: 'contact-modal',
    });
    await modal.present();
  }
}
