import { Component, OnInit, OnDestroy } from '@angular/core';
import { ViewWillEnter } from '@ionic/angular/standalone';
import { CommonModule, NgIf } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  IonBackButton,
  IonButtons,
  IonButton,
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
  IonSpinner,
  IonIcon,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  calendarOutline, timeOutline, playCircle, ticketOutline,
  checkmarkCircleOutline, radioButtonOnOutline, hourglassOutline,
  addCircleOutline, checkmarkOutline, homeOutline, logInOutline, personAddOutline,
  videocamOutline, alertCircleOutline
} from 'ionicons/icons';

import { EventsApiService, EventDto } from '../services/events-api.service';
import { RazorpayService } from '../services/razorpay.service';
import { AuthService } from '../services/auth.service';
import { FooterComponent } from '../shared/footer/footer.component';
import { PendingPurchaseService } from '../services/pending-purchase.service';
import { EventTimePipe } from '../pipes/event-time.pipe';

@Component({
  selector: 'app-event-detail',
  templateUrl: './event-detail.page.html',
  styleUrls: ['./event-detail.page.scss'],
  imports: [
    CommonModule,
    NgIf,
    RouterLink,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonContent,
    IonButton,
    IonSpinner,
    IonIcon,
    FooterComponent,
    EventTimePipe,
  ],
})
export class EventDetailPage implements OnInit, OnDestroy, ViewWillEnter {
  isLoading = true;
  errorMessage = '';

  event: EventDto | null = null;
  hasPaidTicket = false;
  hasSeasonTicket = false;
  seasonTicketPurchasedAt: string | null = null;
  isSubscribed = false;
  isTogglingSubscription = false;
  isStreamLive = false;
  streamState = 'CHECKING';
  isProcessingPayment = false;
  isPastEvent = false;
  isLoggedIn = false;
  isAdmin = false;

  // Recording expiry info from backend (per-user)
  recordingExpiryInfo: { expiresAt: Date; isExpired: boolean } | null = null;

  private eventId: string | null = null;
  private streamCheckTimer?: any;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private eventsApi: EventsApiService,
    private razorpay: RazorpayService,
    private auth: AuthService,
    private pendingPurchase: PendingPurchaseService
  ) {
    addIcons({
      calendarOutline, timeOutline, playCircle, ticketOutline,
      checkmarkCircleOutline, radioButtonOnOutline, hourglassOutline,
      addCircleOutline, checkmarkOutline, homeOutline, logInOutline, personAddOutline,
      videocamOutline, alertCircleOutline
    });
  }

  async ngOnInit() {
    await this.loadEventData();
  }

  async ionViewWillEnter() {
    // Reload data when navigating to this page (e.g., after purchasing a ticket)
    await this.loadEventData();
  }

  private async loadEventData() {
    await this.auth.init();
    const user = this.auth.getUserSync();
    this.isLoggedIn = !!user;
    const adminRoles = ['admin', 'superadmin', 'finance-admin', 'content-admin'];
    this.isAdmin = user?.role ? adminRoles.includes(user.role) : false;

    this.eventId = this.route.snapshot.paramMap.get('id');
    if (!this.eventId) {
      this.errorMessage = 'Missing event id';
      this.isLoading = false;
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';

    try {
      this.event = await this.eventsApi.getEvent(this.eventId);
      this.isPastEvent = new Date(this.event.ends_at).getTime() < Date.now();
      
      // Only fetch access info if logged in
      if (this.isLoggedIn) {
        const access = await this.eventsApi.getAccess(this.eventId);
        this.hasPaidTicket = access.hasPaidTicket;
        this.hasSeasonTicket = access.hasSeasonTicket || false;
        this.seasonTicketPurchasedAt = access.seasonTicketPurchasedAt || null;
        this.isSubscribed = access.isSubscribed || access.hasSeasonTicket || false;

        // Load recording expiry info if user has access
        if (this.hasAccessToEvent()) {
          await this.loadRecordingExpiryInfo();
        }
      }

      // Start checking stream status only for non-past events
      if (!this.isPastEvent) {
        this.startStreamStatusCheck();
      }
    } catch (e: any) {
      this.errorMessage = e?.error?.error || e?.message || 'Failed to load event';
    } finally {
      this.isLoading = false;
    }
  }

  ngOnDestroy() {
    if (this.streamCheckTimer) {
      clearInterval(this.streamCheckTimer);
      this.streamCheckTimer = undefined;
    }
  }

  private async loadRecordingExpiryInfo() {
    if (!this.eventId) return;

    try {
      const response = await this.eventsApi.getRecordingExpiryInfo();

      // Get expiry info for this specific event
      const info = response.expiryInfo[this.eventId];
      if (info) {
        this.recordingExpiryInfo = {
          expiresAt: new Date(info.expiresAt),
          isExpired: info.isExpired
        };
      }
    } catch {
      // Silently fail - user might not have access
      this.recordingExpiryInfo = null;
    }
  }

  private startStreamStatusCheck() {
    if (!this.eventId) return;

    // Check immediately
    this.checkStreamStatus();

    // Then check every 10 seconds
    this.streamCheckTimer = setInterval(() => {
      this.checkStreamStatus();
    }, 10000);
  }

  private async checkStreamStatus() {
    if (!this.eventId) return;

    try {
      const status = await this.eventsApi.getStreamStatus(this.eventId);
      this.isStreamLive = status.isLive;
      this.streamState = status.state;
    } catch {
      // Silently fail
    }
  }

  async toggleSubscription() {
    if (!this.eventId) return;

    this.isTogglingSubscription = true;
    try {
      if (this.isSubscribed) {
        await this.eventsApi.unsubscribe(this.eventId);
      } else {
        await this.eventsApi.subscribe(this.eventId);
      }

      const access = await this.eventsApi.getAccess(this.eventId);
      this.hasPaidTicket = access.hasPaidTicket;
      this.isSubscribed = access.isSubscribed;
    } catch (e: any) {
      this.errorMessage = e?.error?.error || e?.message || 'Failed to update subscription';
    } finally {
      this.isTogglingSubscription = false;
    }
  }

  // Check if event is covered by season ticket
  isEventCoveredBySeasonTicket(): boolean {
    if (!this.hasSeasonTicket || !this.seasonTicketPurchasedAt || !this.event) return false;
    return new Date(this.event.starts_at) >= new Date(this.seasonTicketPurchasedAt);
  }

  // Check if user has access to this event (admin OR individual ticket OR covered by season ticket)
  hasAccessToEvent(): boolean {
    // Admin has unrestricted access to all events
    if (this.isAdmin) return true;
    if (this.hasPaidTicket) return true;
    return this.isEventCoveredBySeasonTicket();
  }

  // Check if user can purchase ticket for a past event
  canPurchasePastEvent(): boolean {
    if (!this.event) return false;

    // Must be a paid event
    if (this.event.event_type !== 'paid') return false;

    // Must have allow_past_purchase enabled
    if (!this.event.allow_past_purchase) return false;

    // Event must have ended
    if (!this.isPastEvent) return false;

    // User must not already have access
    if (this.hasAccessToEvent()) return false;

    // Don't allow purchase if recording has expired
    if (this.isRecordingExpired()) return false;

    return true;
  }

  isRecordingAvailable(): boolean {
    if (!this.event) return false;
    const endsAtMs = new Date(this.event.ends_at).getTime();
    const nowMs = Date.now();

    // Event must have ended
    if (nowMs < endsAtMs) return false;

    // For recording-only events, add the recording_available_hours delay
    const availableHours = this.event.recording_available_hours || 0;
    const availableAtMs = endsAtMs + (availableHours * 60 * 60 * 1000);
    if (nowMs < availableAtMs) return false;

    // Recording is available (expiry is checked separately with isRecordingExpired)
    return true;
  }

  isRecordingExpired(): boolean {
    // Use backend expiry data if available (per-user based on payment date)
    if (this.recordingExpiryInfo) {
      return this.recordingExpiryInfo.isExpired;
    }

    // Fallback to frontend calculation if backend data not available
    if (!this.event) return false;
    const endsAtMs = new Date(this.event.ends_at).getTime();
    const nowMs = Date.now();

    // Event must have ended
    if (nowMs < endsAtMs) return false;

    // Add recording_available_hours delay before calculating expiry
    const availableHours = this.event.recording_available_hours || 0;
    const availableAtMs = endsAtMs + (availableHours * 60 * 60 * 1000);

    // Check if recording has expired (72 hours = 3 days * 24 hours * 60 min * 60 sec * 1000 ms after it becomes available)
    const expiryMs = availableAtMs + (3 * 24 * 60 * 60 * 1000);

    return nowMs > expiryMs;
  }

  getRecordingTimeRemaining(): string {
    // Use backend expiry data if available (per-user based on payment date)
    if (this.recordingExpiryInfo) {
      const now = new Date();
      const diffMs = this.recordingExpiryInfo.expiresAt.getTime() - now.getTime();

      if (diffMs <= 0) return 'Expired';

      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffDays = Math.floor(diffHours / 24);
      const remainingHours = diffHours % 24;

      if (diffDays > 0) {
        return `${diffDays}d ${remainingHours}h left`;
      }
      return `${diffHours}h left`;
    }

    // Fallback to frontend calculation if backend data not available
    if (!this.event) return '';
    const endsAt = new Date(this.event.ends_at);
    // Add recording_available_hours delay before calculating expiry
    const availableHours = this.event.recording_available_hours || 0;
    const availableAtMs = endsAt.getTime() + (availableHours * 60 * 60 * 1000);
    // Add 3 days (72 hours) in milliseconds
    const expiryMs = availableAtMs + (3 * 24 * 60 * 60 * 1000);
    const expiryDate = new Date(expiryMs);

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

  getRecordingAvailableAt(): string {
    if (!this.event) return '';
    const endsAt = new Date(this.event.ends_at);
    const availableHours = this.event.recording_available_hours || 0;
    const availableAt = new Date(endsAt.getTime() + (availableHours * 60 * 60 * 1000));
    return availableAt.toLocaleString('en-IN', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric', 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  }

  async buyTicket() {
    if (!this.eventId || !this.event) return;

    // If not logged in, redirect to register with pending purchase
    if (!this.isLoggedIn) {
      this.pendingPurchase.setPendingPurchase({
        type: 'ticket',
        eventId: this.eventId,
        eventTitle: this.event.title
      });
      this.router.navigate(['/register']);
      return;
    }

    this.isProcessingPayment = true;
    this.errorMessage = '';

    try {
      // Create order - backend determines price based on user's country
      const order = await this.razorpay.createOrder(this.eventId);

      // Open payment modal
      const user = this.auth.getUserSync();
      const paymentResult = await this.razorpay.openPaymentModal({
        orderId: order.orderId,
        amount: order.amount,
        currency: order.currency,
        name: 'Sankeertanotsav 2026',
        description: `Ticket for ${this.event.title}`,
        prefillEmail: user?.email,
      });

      // Verify payment
      const verifyResult = await this.razorpay.verifyPayment(paymentResult, this.eventId, order.amount, order.currency);

      // Reload recording expiry info after successful payment
      await this.loadRecordingExpiryInfo();

      // Navigate to invoice if available
      if (verifyResult.invoiceId) {
        this.router.navigate(['/invoice', verifyResult.invoiceId], {
          queryParams: { returnUrl: `/event/${this.eventId}` },
          replaceUrl: true
        });
        return;
      }

      // Refresh access status (fallback if no invoice)
      const access = await this.eventsApi.getAccess(this.eventId);
      this.hasPaidTicket = access.hasPaidTicket;
      this.isSubscribed = access.isSubscribed;
    } catch (e: any) {
      if (e?.message !== 'Payment cancelled by user') {
        this.errorMessage = e?.error?.error || e?.message || 'Payment failed';
      }
    } finally {
      this.isProcessingPayment = false;
    }
  }

}
