import { Component, ElementRef, OnDestroy, OnInit, ViewChild, NgZone, ChangeDetectorRef } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DatePipe, JsonPipe, NgFor, NgIf, NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';

// Diagnostic interfaces for IVS player debugging
interface DiagnosticEvent {
  timestamp: Date;
  type: 'state' | 'quality' | 'buffer' | 'error' | 'seek' | 'token' | 'anomaly' | 'metric';
  message: string;
  data?: Record<string, any>;
  isAnomaly?: boolean;
}

interface PlayerMetrics {
  position: number;
  bufferDuration: number;
  quality: string;
  bitrate: number;
  playbackRate: number;
  readyState: number;
  networkState: number;
}

interface TokenStatus {
  expiresAt: string;
  timeUntilRefresh: number;
  lastRefreshAt: Date | null;
  refreshCount: number;
  positionBeforeRefresh: number | null;
  positionAfterRefresh: number | null;
}

import {
  IonBackButton,
  IonButtons,
  IonButton,
  IonContent,
  IonHeader,
  IonItem,
  IonTextarea,
  IonTitle,
  IonToolbar,
  IonIcon,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { homeOutline } from 'ionicons/icons';

import { IvsPlayerService, IvsPlayerConfig } from '../services/ivs-player.service';
import { EventCommentDto, EventDto, EventsApiService } from '../services/events-api.service';
import { IvsApiService } from '../services/ivs-api.service';
import { ViewingSessionService } from '../services/viewing-session.service';
import { RecordingsApiService } from '../services/recordings-api.service';
import { FooterComponent } from '../shared/footer/footer.component';
import { AuthService } from '../services/auth.service';
import { EventTimePipe } from '../pipes/event-time.pipe';

@Component({
  selector: 'app-watch',
  templateUrl: './watch.page.html',
  styleUrls: ['./watch.page.scss'],
  imports: [
    FormsModule,
    RouterLink,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonContent,
    IonItem,
    IonTextarea,
    IonButton,
    IonIcon,
    DatePipe,
    JsonPipe,
    NgIf,
    NgFor,
    NgClass,
    FooterComponent,
    EventTimePipe,
  ],
})
export class WatchPage implements OnInit, OnDestroy {
  @ViewChild('videoEl', { static: true }) videoElRef!: ElementRef<HTMLVideoElement>;

  isLoading = true;
  errorMessage = '';
  streamStatus: 'loading' | 'live' | 'offline' | 'error' | 'device-limit' | 'recording' | 'ended' = 'loading';
  isRecordingMode = false;
  isPastEvent = false;
  recordingExpiresAt: string | null = null;
  recordingUrlExpiresAt: string | null = null;
  viewerCount = 0;
  deviceLimitMessage = '';
  maxDevices = 3;

  event: EventDto | null = null;

  comments: EventCommentDto[] = [];
  commentText = '';
  isSubmittingComment = false;

  quickEmojis = [
    { char: '👏', name: 'Applause' },
    { char: '🙏', name: 'Namaste' },
    { char: '👍', name: 'Thumbs Up' },
    { char: '❤️', name: 'Love' },
    { char: '🔥', name: 'Fire' },
    { char: '🎵', name: 'Music' },
    { char: '✨', name: 'Amazing' },
    { char: '🙌', name: 'Praise' },
    { char: '💯', name: 'Perfect' },
    { char: '🎶', name: 'Melody' },
  ];

  private eventId: string | null = null;
  private playbackUrl: string | null = null;

  private player: any;
  private refreshTimer?: any;
  private commentsTimer?: any;
  private viewerCountTimer?: any;
  private recordingUrlRefreshTimer?: any;

  // Error recovery state
  private errorRetryCount = 0;
  private maxErrorRetries = 3;
  private errorRetryTimer?: any;
  private lastErrorTime = 0;
  private cachedTokenUrl: string | null = null; // Pre-fetched token URL for error recovery

  // Stall detection and recovery
  private stallCount = 0;
  private lastStallRecoveryTime = 0;
  private stallRecoveryTimer?: any;
  private consecutiveStalls = 0;

  // Adaptive quality management
  private qualityCeiling: any = null; // null = no ceiling (auto)
  private sessionMaxStableQuality: any = null; // Highest quality that played stably this session
  private stablePlaybackStartTime = 0;
  private qualityStableThreshold = 60000; // 60 seconds of stable playback to consider quality stable
  private lastQualityChangeTime = 0;
  private currentQualityBitrate = 0;
  private qualityAdjustmentInProgress = false;

  // Progressive recovery timing
  private recoveryWaitTimes = [30000, 60000, 120000]; // 30s, 60s, 120s
  private currentRecoveryWaitIndex = 0;
  private lastRecoveryAttemptTime = 0;

  // Quality notification
  showQualityNotification = false;
  qualityNotificationMessage = '';
  private qualityNotificationTimer?: any;

  // Cached YouTube embed URL to prevent iframe re-rendering
  private cachedYouTubeEmbedUrl: SafeResourceUrl | null = null;
  private cachedYouTubeSourceUrl: string | null = null;

  // Multi-session recording playback
  recordingSessions: { index: number; sessionId: string; timestamp: string; dateTime: string; playbackUrl: string; expiresAt: string }[] = [];
  currentSessionIndex = 0;
  totalSessions = 0;

  private isLoggedIn = false;
  private isAdmin = false;
  private hasPaidTicket = false;
  private hasSeasonTicket = false;
  private seasonTicketPurchasedAt: string | null = null;

  // Diagnostic mode properties
  debugMode = false;
  showDiagnosticPanel = false;
  diagnosticEvents: DiagnosticEvent[] = [];
  currentMetrics: PlayerMetrics = {
    position: 0,
    bufferDuration: 0,
    quality: 'N/A',
    bitrate: 0,
    playbackRate: 1,
    readyState: 0,
    networkState: 0,
  };
  tokenStatus: TokenStatus = {
    expiresAt: '',
    timeUntilRefresh: 0,
    lastRefreshAt: null,
    refreshCount: 0,
    positionBeforeRefresh: null,
    positionAfterRefresh: null,
  };
  anomalyCount = 0;
  private metricsTimer?: any;
  private lastPosition = 0;
  private lastPositionTime = 0;
  private tokenExpiresAt = '';

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private ivsPlayer: IvsPlayerService,
    private eventsApi: EventsApiService,
    private ivsApi: IvsApiService,
    private viewingSession: ViewingSessionService,
    private recordingsApi: RecordingsApiService,
    private sanitizer: DomSanitizer,
    private ngZone: NgZone,
    private auth: AuthService,
    private cdr: ChangeDetectorRef
  ) {
    addIcons({ homeOutline });
  }

  async ngOnInit() {
    // Check authentication first
    await this.auth.init();
    const user = this.auth.getUserSync();
    this.isLoggedIn = !!user;
    this.isAdmin = user?.role === 'admin';

    this.eventId = this.route.snapshot.paramMap.get('id');
    const mode = this.route.snapshot.queryParamMap.get('mode');
    this.isRecordingMode = mode === 'recording';

    // Check for debug mode via URL parameter
    const debugParam = this.route.snapshot.queryParamMap.get('debug');
    this.debugMode = debugParam === 'player';
    if (this.debugMode) {
      this.showDiagnosticPanel = true;
      this.logDiagnostic('metric', 'Diagnostic mode enabled', { url: window.location.href });
      console.log('[IVS Diagnostics] Debug mode enabled. Panel visible.');
    }

    if (!this.eventId) {
      this.isLoading = false;
      this.errorMessage = 'Missing event id';
      return;
    }

    // Must be logged in to watch any event
    if (!this.isLoggedIn) {
      this.router.navigate(['/login']);
      return;
    }

    try {
      this.event = await this.eventsApi.getEvent(this.eventId);
      this.isPastEvent = new Date(this.event.ends_at).getTime() < Date.now();

      // Verify access for paid events
      if (this.event.event_type === 'paid') {
        const hasAccess = await this.verifyAccess();
        if (!hasAccess) {
          this.isLoading = false;
          this.errorMessage = 'You do not have access to this event. Please purchase a ticket.';
          this.streamStatus = 'error';
          return;
        }
      }

      // Handle free events (YouTube) - both 'free' and 'free-short'
      if (this.event.event_type === 'free' || this.event.event_type === 'free-short') {
        if (!this.event.youtube_url) {
          throw new Error('YouTube URL is not configured for this event');
        }
        this.streamStatus = 'live';
        this.comments = await this.eventsApi.listComments(this.eventId);
        this.startCommentsRefresh();
        this.isLoading = false;
        return;
      }

      // Handle recording playback mode OR recording-only events that have ended and recording is available
      const recordingAvailableHours = this.event.recording_available_hours || 0;
      const endsAtMs = new Date(this.event.ends_at).getTime();
      const recordingAvailableAtMs = endsAtMs + (recordingAvailableHours * 60 * 60 * 1000);
      const isRecordingAvailableNow = Date.now() >= recordingAvailableAtMs;
      
      if (this.isRecordingMode || (this.event.recording_only && this.isPastEvent && isRecordingAvailableNow)) {
        this.isRecordingMode = true; // Ensure recording mode is set for recording-only events
        await this.initRecordingPlayback();
        return;
      }

      // For recording-only events that haven't ended yet or recording not yet available, show a message
      if (this.event.recording_only && (!this.isPastEvent || !isRecordingAvailableNow)) {
        this.isLoading = false;
        const availableAt = new Date(recordingAvailableAtMs);
        const formattedTime = availableAt.toLocaleString('en-IN', { 
          year: 'numeric', 
          month: 'short', 
          day: 'numeric', 
          hour: '2-digit', 
          minute: '2-digit' 
        });
        this.errorMessage = `This is a Deferred Live event. Recording will be available on ${formattedTime}.`;
        this.streamStatus = 'offline';
        return;
      }

      // Handle paid events (IVS live stream)
      const playbackUrl = this.event.playback_url;

      if (!playbackUrl) {
        throw new Error('Playback URL is not configured for this event');
      }

      this.playbackUrl = playbackUrl;

      // Start viewing session (enforces device limit)
      const sessionResult = await this.viewingSession.startSession(this.eventId);
      if (!sessionResult.success) {
        this.streamStatus = 'device-limit';
        this.deviceLimitMessage = sessionResult.error || 'Device limit reached';
        this.maxDevices = sessionResult.maxDevices || 3;
        this.isLoading = false;
        return;
      }

      const { token, expiresAt } = await this.ivsApi.getPlaybackToken(this.eventId);
      const urlWithToken = `${playbackUrl}?token=${encodeURIComponent(token)}`;

      // Player configuration
      // FIX: Disable low-latency mode to increase buffer and prevent position jumps/audio ticks
      // This increases the buffer from ~1.2s to ~6s, reducing micro-buffering issues
      // NOTE: No maxBitrate set - using adaptive quality management instead
      const playerConfig: IvsPlayerConfig = {
        disableLowLatency: true,  // Increases buffer, reduces micro-buffering and position jumps
        verboseLogging: this.debugMode,  // Only verbose logging in debug mode
      };

      this.logDiagnostic('state', 'Creating player', { url: playbackUrl, hasToken: !!token });

      // Configure video element for optimal streaming performance
      this.configureVideoElement();

      try {
        this.player = await this.ivsPlayer.createAndAttachPlayer(
          this.videoElRef.nativeElement,
          urlWithToken,
          playerConfig
        );
        this.logDiagnostic('state', 'Player created successfully');
      } catch (playerError: any) {
        this.logDiagnostic('error', `Player creation failed: ${playerError?.message}`, { error: playerError }, true);
        throw playerError;
      }

      // Listen for player state changes
      this.setupPlayerListeners();

      // Enable sound by default
      this.videoElRef.nativeElement.muted = false;
      this.videoElRef.nativeElement.volume = 1;

      
      await this.player.play();
      

      this.scheduleRefresh(this.eventId, playbackUrl, expiresAt);

      this.comments = await this.eventsApi.listComments(this.eventId);

      // Start auto-refresh for comments
      this.startCommentsRefresh();

      // Start viewer count polling
      this.startViewerCountPolling();
    } catch (e: any) {
      this.streamStatus = 'error';
      this.errorMessage = this.getErrorMessage(e);
    } finally {
      this.isLoading = false;
    }
  }

  getEventAvatarInitial(): string {
    const title = this.event?.title || 'U';
    const first = title.trim().slice(0, 1);
    return (first || 'U').toUpperCase();
  }

  getYouTubeEmbedUrl(): SafeResourceUrl | null {
    if (!this.event?.youtube_url) return null;
    
    const url = this.event.youtube_url;
    
    // Return cached URL if source hasn't changed
    if (this.cachedYouTubeSourceUrl === url && this.cachedYouTubeEmbedUrl) {
      return this.cachedYouTubeEmbedUrl;
    }
    
    let videoId: string | null = null;

    // Handle various YouTube URL formats
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
      /youtube\.com\/live\/([a-zA-Z0-9_-]{11})/
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        videoId = match[1];
        break;
      }
    }

    if (!videoId) return null;
    
    const embedUrl = `https://www.youtube.com/embed/${videoId}?autoplay=1`;
    this.cachedYouTubeSourceUrl = url;
    this.cachedYouTubeEmbedUrl = this.sanitizer.bypassSecurityTrustResourceUrl(embedUrl);
    return this.cachedYouTubeEmbedUrl;
  }

  /**
   * Initialize recording playback mode.
   * Fetches signed CloudFront URLs for all sessions and sets up HLS player.
   * Supports sequential playback of multiple recording sessions.
   */
  private async initRecordingPlayback(): Promise<void> {
    if (!this.eventId) return;

    try {
      const recording = await this.recordingsApi.getPlaybackUrl(this.eventId);
      
      // Store all sessions for sequential playback
      if (recording.sessions && recording.sessions.length > 0) {
        this.recordingSessions = recording.sessions;
        this.totalSessions = recording.totalSessions || recording.sessions.length;
        this.currentSessionIndex = 0;
      } else {
        // Fallback for single session (backward compatibility)
        this.recordingSessions = [{
          index: 0,
          sessionId: 'default',
          timestamp: '',
          dateTime: '',
          playbackUrl: recording.playbackUrl,
          expiresAt: recording.expiresAt,
        }];
        this.totalSessions = 1;
        this.currentSessionIndex = 0;
      }

      this.playbackUrl = this.recordingSessions[0].playbackUrl;
      this.recordingExpiresAt = recording.recordingExpiresAt;
      this.recordingUrlExpiresAt = this.recordingSessions[0].expiresAt;
      this.streamStatus = 'recording';

      // Create HLS player for first session
      this.player = await this.ivsPlayer.createAndAttachPlayer(
        this.videoElRef.nativeElement,
        this.playbackUrl
      );

      this.setupPlayerListeners();

      this.videoElRef.nativeElement.muted = false;
      this.videoElRef.nativeElement.volume = 1;

      await this.player.play();

      // Schedule URL refresh before it expires (5 minutes before)
      this.scheduleRecordingUrlRefresh(this.recordingSessions[0].expiresAt);

      // Load comments
      this.comments = await this.eventsApi.listComments(this.eventId);
      this.startCommentsRefresh();

    } catch (e: any) {
      this.streamStatus = 'error';
      
      // Handle specific error cases
      if (e?.status === 410) {
        this.errorMessage = 'Recording has expired. Recordings are only available for 3 days after the event.';
      } else if (e?.status === 404) {
        this.errorMessage = 'Recording not found. The recording may not be available yet.';
      } else if (e?.status === 403) {
        this.errorMessage = 'You do not have access to this recording. Please purchase a ticket.';
      } else {
        this.errorMessage = e?.error?.error || e?.message || 'Failed to load recording';
      }
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Setup listener for when a recording session ends to auto-play next session.
   */
  private setupSessionEndListener(): void {
    if (!this.videoElRef?.nativeElement) return;

    this.videoElRef.nativeElement.addEventListener('ended', () => {
      this.ngZone.run(() => {
        this.playNextSession();
      });
    });
  }

  /**
   * Play the next recording session if available.
   */
  async playNextSession(): Promise<void> {
    if (this.currentSessionIndex >= this.totalSessions - 1) {
      this.streamStatus = 'ended';
      return;
    }

    this.currentSessionIndex++;
    const nextSession = this.recordingSessions[this.currentSessionIndex];
    
    try {
      // Load the next session URL
      this.playbackUrl = nextSession.playbackUrl;
      this.recordingUrlExpiresAt = nextSession.expiresAt;

      // Update player source
      if (this.player) {
        this.player.load(nextSession.playbackUrl);
        await this.player.play();
      }

      // Schedule URL refresh for this session
      this.scheduleRecordingUrlRefresh(nextSession.expiresAt);
    } catch (e: any) {
      console.error('[Watch] Error playing next session:', e);
      this.errorMessage = 'Failed to play next recording segment';
    }
  }

  /**
   * Play a specific session by index.
   */
  async playSession(index: number): Promise<void> {
    if (index < 0 || index >= this.totalSessions) return;

    this.currentSessionIndex = index;
    const session = this.recordingSessions[index];
    
    try {
      this.playbackUrl = session.playbackUrl;
      this.recordingUrlExpiresAt = session.expiresAt;

      if (this.player) {
        this.player.load(session.playbackUrl);
        await this.player.play();
      }

      this.scheduleRecordingUrlRefresh(session.expiresAt);
    } catch (e: any) {
      console.error('[Watch] Error playing session:', e);
    }
  }

  /**
   * Schedule automatic refresh of recording URL before it expires.
   */
  private scheduleRecordingUrlRefresh(expiresAt: string): void {
    if (this.recordingUrlRefreshTimer) {
      clearTimeout(this.recordingUrlRefreshTimer);
    }

    const timeUntilExpiry = this.recordingsApi.getTimeUntilExpiry(expiresAt);
    const refreshTime = Math.max(timeUntilExpiry - 5 * 60 * 1000, 60 * 1000); // 5 min before or at least 1 min

    this.recordingUrlRefreshTimer = setTimeout(async () => {
      await this.refreshRecordingUrl();
    }, refreshTime);
  }

  /**
   * Refresh the recording playback URL when it's about to expire.
   */
  private async refreshRecordingUrl(): Promise<void> {
    if (!this.eventId || !this.isRecordingMode) return;

    try {
      const recording = await this.recordingsApi.getPlaybackUrl(this.eventId);
      
      this.playbackUrl = recording.playbackUrl;
      this.recordingUrlExpiresAt = recording.expiresAt;

      // Update player source
      if (this.player) {
        const currentTime = this.videoElRef.nativeElement.currentTime;
        this.player.load(recording.playbackUrl);
        
        // Resume from current position after source change
        this.videoElRef.nativeElement.currentTime = currentTime;
        await this.player.play();
      }

      // Schedule next refresh
      this.scheduleRecordingUrlRefresh(recording.expiresAt);

    } catch (e: any) {
      console.error('Failed to refresh recording URL:', e);
      this.errorMessage = 'Failed to refresh playback. Please reload the page.';
    }
  }

  addEmoji(emoji: string) {
    this.commentText += emoji;
  }

  async resumePlayback() {
    if (!this.player) return;
    
    try {
      await this.player.play();
      this.streamStatus = this.isRecordingMode ? 'recording' : 'live';
    } catch (err) {
      console.error('[Watch] Failed to resume playback:', err);
    }
  }

  async shareEvent() {
    const shareUrl = 'https://events.edifyplus.com';
    const shareData = {
      title: this.event?.title || 'Live Concert',
      text: `Watch ${this.event?.title || 'this live concert'} now!`,
      url: shareUrl
    };

    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        // Fallback: copy to clipboard
        await navigator.clipboard.writeText(shareUrl);
        alert('Link copied to clipboard!');
      }
    } catch (err) {
      // User cancelled or error
      console.log('Share failed:', err);
    }
  }

  async submitComment() {
    if (!this.eventId) return;

    const body = this.commentText.trim();
    if (!body) return;

    this.isSubmittingComment = true;
    try {
      const comment = await this.eventsApi.addComment(this.eventId, body);
      this.comments = [comment, ...this.comments];
      this.commentText = '';
    } catch (e: any) {
      this.errorMessage = e?.error?.error || e?.message || 'Failed to post comment';
    } finally {
      this.isSubmittingComment = false;
    }
  }

  /**
   * Schedule token pre-fetch for seamless playback.
   *
   * IMPORTANT: For IVS live streams, we do NOT reload the player when refreshing tokens.
   * The token is only used for the initial manifest fetch. Once playback starts, the player
   * continues without needing the token. We pre-fetch a new token so it's ready if the
   * player needs to recover from an error or if we need to reload for any reason.
   *
   * Reloading the player with player.load() causes it to restart from the live edge,
   * which resets playback position and causes the buffering/jumping issues.
   */
  private scheduleRefresh(eventId: string, playbackUrl: string, expiresAtIso: string) {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }

    const expiresAt = new Date(expiresAtIso).getTime();
    const now = Date.now();

    // Pre-fetch new token ~90 seconds before expiry; min 30s.
    const delayMs = Math.max(30_000, expiresAt - now - 90_000);

    // Update token status for diagnostics
    this.tokenExpiresAt = expiresAtIso;
    this.tokenStatus.expiresAt = expiresAtIso;
    this.tokenStatus.timeUntilRefresh = Math.round(delayMs / 1000);

    this.logDiagnostic('token', `Token pre-fetch scheduled (no reload)`, {
      expiresAt: expiresAtIso,
      refreshInSeconds: Math.round(delayMs / 1000),
      refreshInMinutes: (delayMs / 60000).toFixed(1),
    });

    this.refreshTimer = setTimeout(async () => {
      const currentPosition = this.player?.getPosition?.() || 0;
      const currentBuffer = this.player?.getBufferDuration?.() || 0;
      const refreshStartTime = Date.now();

      this.tokenStatus.positionBeforeRefresh = currentPosition;

      this.logDiagnostic('token', 'Token pre-fetch STARTING (player continues uninterrupted)', {
        currentPosition: currentPosition.toFixed(2),
        currentBuffer: currentBuffer.toFixed(2),
      });

      try {
        // Pre-fetch new token for future use (error recovery, etc.)
        const { token, expiresAt: nextExpires } = await this.ivsApi.getPlaybackToken(eventId);

        // Store the fresh token URL for error recovery
        this.cachedTokenUrl = `${playbackUrl}?token=${encodeURIComponent(token)}`;

        const tokenFetchDuration = Date.now() - refreshStartTime;

        this.tokenStatus.positionAfterRefresh = currentPosition; // Position unchanged
        this.tokenStatus.lastRefreshAt = new Date();
        this.tokenStatus.refreshCount++;

        this.logDiagnostic('token', `Token pre-fetched successfully (${tokenFetchDuration}ms) - NO RELOAD`, {
          fetchDuration: tokenFetchDuration,
          newExpiresAt: nextExpires,
          position: currentPosition.toFixed(2),
          buffer: currentBuffer.toFixed(2),
          refreshCount: this.tokenStatus.refreshCount,
        });

        // Schedule next pre-fetch
        this.scheduleRefresh(eventId, playbackUrl, nextExpires);
      } catch (err: any) {
        const failureDuration = Date.now() - refreshStartTime;
        this.logDiagnostic('error', `Token pre-fetch FAILED after ${failureDuration}ms`, {
          error: err?.message || 'Unknown error',
          duration: failureDuration,
        }, true);

        // Don't show error to user - playback may continue fine
        // Only show error if playback actually fails
        this.logDiagnostic('token', 'Playback continues - will retry token fetch on next schedule');

        // Retry sooner (30 seconds)
        const retryExpiry = new Date(Date.now() + 30000).toISOString();
        this.scheduleRefresh(eventId, playbackUrl, retryExpiry);
      }
    }, delayMs);
  }

  ngOnDestroy() {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    if (this.commentsTimer) {
      clearInterval(this.commentsTimer);
      this.commentsTimer = undefined;
    }
    if (this.viewerCountTimer) {
      clearInterval(this.viewerCountTimer);
      this.viewerCountTimer = undefined;
    }
    if (this.recordingUrlRefreshTimer) {
      clearTimeout(this.recordingUrlRefreshTimer);
      this.recordingUrlRefreshTimer = undefined;
    }
    if (this.errorRetryTimer) {
      clearTimeout(this.errorRetryTimer);
      this.errorRetryTimer = undefined;
    }
    if (this.stallRecoveryTimer) {
      clearTimeout(this.stallRecoveryTimer);
      this.stallRecoveryTimer = undefined;
    }
    if (this.qualityNotificationTimer) {
      clearTimeout(this.qualityNotificationTimer);
      this.qualityNotificationTimer = undefined;
    }
    // Stop metrics sampling for diagnostics
    this.stopMetricsSampling();
    // End viewing session (only for live streams, not recordings)
    if (!this.isRecordingMode) {
      this.viewingSession.endSession();
    }
    this.ivsPlayer.destroyPlayer(this.player);
    this.player = undefined;
  }

  private setupPlayerListeners() {
    if (!this.player) return;

    const PlayerState = window.IVSPlayer?.PlayerState;
    const PlayerEventType = window.IVSPlayer?.PlayerEventType;

    if (PlayerState && PlayerEventType) {
      // STATE_CHANGED event listener
      this.player.addEventListener(PlayerEventType.STATE_CHANGED, (state: string) => {
        this.ngZone.run(() => {
          const position = this.player?.getPosition?.() || 0;
          const buffer = this.player?.getBufferDuration?.() || 0;

          this.logDiagnostic('state', `State changed: ${state}`, {
            position: position.toFixed(2),
            buffer: buffer.toFixed(2),
          });

          switch (state) {
            case PlayerState.PLAYING:
              // Show 'recording' status for recordings, 'live' for live streams
              this.streamStatus = this.isRecordingMode ? 'recording' : 'live';
              this.errorMessage = '';
              // Start metrics sampling when playing
              this.startMetricsSampling();
              break;
            case PlayerState.ENDED:
              // Stream/recording has ended
              if (this.isRecordingMode && this.currentSessionIndex < this.totalSessions - 1) {
                // Auto-play next session
                this.playNextSession();
              } else {
                this.streamStatus = this.isRecordingMode ? 'ended' : 'offline';
              }
              this.stopMetricsSampling();
              break;
            case PlayerState.IDLE:
              // IDLE can mean paused or stopped - don't show offline overlay
              // Keep the current status unless it was never playing
              const playingStatus = this.isRecordingMode ? 'recording' : 'live';
              if (this.streamStatus !== playingStatus) {
                // Only show offline if we never successfully played
                this.streamStatus = 'offline';
              }
              // If streamStatus is playing, user just paused - keep showing video
              break;
            case PlayerState.BUFFERING:
              // Keep current status while buffering
              this.logDiagnostic('buffer', 'Buffering started', { position: position.toFixed(2) });
              break;
            case PlayerState.READY:
              this.logDiagnostic('state', 'Player ready');
              break;
          }
        });
      });

      // ERROR event listener with auto-retry for transient errors
      this.player.addEventListener(PlayerEventType.ERROR, (err: any) => {
        this.ngZone.run(() => {
          const errorCode = err?.code || err?.type || 'unknown';
          this.logDiagnostic('error', `Player error: ${err?.message || 'Unknown'}`, {
            type: err?.type,
            code: err?.code,
            source: err?.source,
            retryCount: this.errorRetryCount,
          }, true);

          // Attempt auto-recovery for transient errors
          if (this.shouldAutoRetry(errorCode)) {
            this.attemptErrorRecovery();
          } else {
            this.streamStatus = 'error';
            this.errorMessage = this.getErrorMessage(err);
          }
        });
      });

      // QUALITY_CHANGED event listener
      this.player.addEventListener(PlayerEventType.QUALITY_CHANGED, (quality: any) => {
        this.ngZone.run(() => {
          const position = this.player?.getPosition?.() || 0;
          this.logDiagnostic('quality', `Quality changed: ${quality?.name || 'unknown'}`, {
            name: quality?.name,
            bitrate: quality?.bitrate,
            codecs: quality?.codecs,
            width: quality?.width,
            height: quality?.height,
            position: position.toFixed(2),
          });
        });
      });

      // REBUFFERING event listener (if available)
      if (PlayerEventType.REBUFFERING) {
        this.player.addEventListener(PlayerEventType.REBUFFERING, () => {
          this.ngZone.run(() => {
            const position = this.player?.getPosition?.() || 0;
            const buffer = this.player?.getBufferDuration?.() || 0;
            this.logDiagnostic('buffer', 'Rebuffering event', {
              position: position.toFixed(2),
              buffer: buffer.toFixed(2),
            }, true);
          });
        });
      }

      // BUFFER_UPDATE event listener (if available)
      if (PlayerEventType.BUFFER_UPDATE) {
        this.player.addEventListener(PlayerEventType.BUFFER_UPDATE, () => {
          // Only log in debug mode and throttle to avoid spam
          if (this.debugMode) {
            const buffer = this.player?.getBufferDuration?.() || 0;
            // Only log significant buffer changes
            if (buffer < 3) {
              this.logDiagnostic('buffer', `Buffer update: ${buffer.toFixed(2)}s`, { buffer });
            }
          }
        });
      }

      // SEEK_COMPLETED event listener (if available)
      if (PlayerEventType.SEEK_COMPLETED) {
        this.player.addEventListener(PlayerEventType.SEEK_COMPLETED, (position: number) => {
          this.ngZone.run(() => {
            this.logDiagnostic('seek', `Seek completed to ${position?.toFixed?.(2) || position}s`, {
              position,
            });
            // Reset position tracking after seek
            this.lastPosition = position || 0;
            this.lastPositionTime = Date.now();
          });
        });
      }

      // DURATION_CHANGED event listener (if available)
      if (PlayerEventType.DURATION_CHANGED) {
        this.player.addEventListener(PlayerEventType.DURATION_CHANGED, (duration: number) => {
          this.ngZone.run(() => {
            this.logDiagnostic('state', `Duration changed: ${duration?.toFixed?.(2) || duration}s`, {
              duration,
            });
          });
        });
      }

      // TEXT_METADATA_CUE event listener (if available) - can indicate stream discontinuities
      if (PlayerEventType.TEXT_METADATA_CUE) {
        this.player.addEventListener(PlayerEventType.TEXT_METADATA_CUE, (cue: any) => {
          this.ngZone.run(() => {
            this.logDiagnostic('metric', 'Metadata cue received', {
              text: cue?.text,
              startTime: cue?.startTime,
              endTime: cue?.endTime,
            });
          });
        });
      }
    }

    // Video element event listeners - stall recovery for all modes, diagnostics for debug mode
    const videoEl = this.videoElRef?.nativeElement;
    if (videoEl) {
      // Stall recovery - always active for live streams
      if (!this.isRecordingMode) {
        videoEl.addEventListener('waiting', () => {
          this.handleVideoStall(videoEl);
        });

        // Playing event resets stall counter
        videoEl.addEventListener('playing', () => {
          this.consecutiveStalls = 0;
        });
      }

      // Additional diagnostics only in debug mode
      if (this.debugMode) {
        videoEl.addEventListener('waiting', () => {
          this.logDiagnostic('buffer', 'Video waiting (stalled)', {
            position: videoEl.currentTime.toFixed(2),
            readyState: videoEl.readyState,
            networkState: videoEl.networkState,
            consecutiveStalls: this.consecutiveStalls,
          }, true);
        });

        videoEl.addEventListener('stalled', () => {
          this.logDiagnostic('buffer', 'Video stalled', {
            position: videoEl.currentTime.toFixed(2),
            readyState: videoEl.readyState,
          }, true);
        });

        videoEl.addEventListener('suspend', () => {
          this.logDiagnostic('buffer', 'Video suspend (download paused)', {
            position: videoEl.currentTime.toFixed(2),
          });
        });

        videoEl.addEventListener('seeking', () => {
          this.logDiagnostic('seek', 'Seeking started', {
            position: videoEl.currentTime.toFixed(2),
          });
        });

        videoEl.addEventListener('seeked', () => {
          this.logDiagnostic('seek', 'Seeking ended', {
            position: videoEl.currentTime.toFixed(2),
          });
          // Reset position tracking after user seek
          this.lastPosition = videoEl.currentTime;
          this.lastPositionTime = Date.now();
        });
      }
    }
  }

  /**
   * Handle video stall events with progressive recovery.
   * For persistent stalls, attempts to recover by seeking or reloading.
   */
  private handleVideoStall(videoEl: HTMLVideoElement): void {
    this.stallCount++;
    this.consecutiveStalls++;
    const now = Date.now();

    // Don't attempt recovery too frequently (wait at least 3 seconds between attempts)
    if (now - this.lastStallRecoveryTime < 3000) {
      return;
    }

    this.logDiagnostic('state', `Stall detected (${this.consecutiveStalls} consecutive)`, {
      position: videoEl.currentTime.toFixed(2),
      readyState: videoEl.readyState,
      buffer: this.player?.getBufferDuration?.()?.toFixed(2),
    });

    // Clear any existing recovery timer
    if (this.stallRecoveryTimer) {
      clearTimeout(this.stallRecoveryTimer);
    }

    // Schedule recovery attempt after a short delay to see if it resolves naturally
    this.stallRecoveryTimer = setTimeout(() => {
      // Check if still stalled (readyState 2 = HAVE_CURRENT_DATA, not enough to play)
      if (videoEl.readyState <= 2 && !videoEl.paused) {
        this.attemptStallRecovery(videoEl);
      }
    }, 2000);
  }

  /**
   * Attempt to recover from a persistent stall using adaptive quality management.
   * Uses progressive recovery timing and remembers quality that works for the session.
   */
  private attemptStallRecovery(videoEl: HTMLVideoElement): void {
    const now = Date.now();
    this.lastStallRecoveryTime = now;

    const buffer = this.player?.getBufferDuration?.() || 0;
    const liveLatency = this.player?.getLiveLatency?.() || 0;
    const currentQuality = this.player?.getQuality?.();

    this.logDiagnostic('state', `Attempting stall recovery`, {
      consecutiveStalls: this.consecutiveStalls,
      buffer: buffer.toFixed(2),
      liveLatency: liveLatency.toFixed(2),
      position: videoEl.currentTime.toFixed(2),
      currentQuality: currentQuality?.name,
      qualityCeiling: this.qualityCeiling?.name || 'none',
    });

    // Strategy based on consecutive stalls
    if (this.consecutiveStalls <= 2) {
      // Strategy 1: Try to seek slightly forward within buffer
      if (buffer > 2) {
        const seekTarget = videoEl.currentTime + 1;
        this.logDiagnostic('state', `Recovery: Seeking forward to ${seekTarget.toFixed(2)}`);
        if (typeof this.player?.seekTo === 'function') {
          this.player.seekTo(seekTarget);
        } else {
          videoEl.currentTime = seekTarget;
        }
      }
    } else if (this.consecutiveStalls <= 4) {
      // Strategy 2: Seek to live edge
      this.logDiagnostic('state', 'Recovery: Seeking to live edge');
      if (typeof this.player?.seekTo === 'function' && liveLatency > 0) {
        this.player.seekTo(videoEl.currentTime + liveLatency - 3);
      }
    } else {
      // Strategy 3: Lower quality ceiling and enforce it
      this.lowerQualityCeiling();
    }
  }

  /**
   * Lower the quality ceiling when playback issues persist.
   * This sets a cap on the maximum quality ABR can select.
   * Uses session's known-good quality if available.
   */
  private lowerQualityCeiling(): void {
    const qualities = this.player?.getQualities?.() || [];
    const currentQuality = this.player?.getQuality?.();

    if (qualities.length <= 1 || !currentQuality) {
      this.logDiagnostic('state', 'Cannot lower quality - no alternatives available');
      // Last resort: full reload
      if (this.consecutiveStalls > 10 && this.cachedTokenUrl && this.player) {
        this.logDiagnostic('state', 'Recovery: Full reload required');
        this.consecutiveStalls = 0;
        this.player.load(this.cachedTokenUrl);
        this.player.play();
      }
      return;
    }

    // Sort qualities by bitrate (highest first)
    const sortedQualities = [...qualities].sort((a: any, b: any) => b.bitrate - a.bitrate);

    // If we have a known stable quality from this session, use that as a smart fallback
    if (this.sessionMaxStableQuality && currentQuality.bitrate > this.sessionMaxStableQuality.bitrate) {
      this.logDiagnostic('state', `Using session's known stable quality: ${this.sessionMaxStableQuality.name}`, {
        currentBitrate: currentQuality.bitrate,
        stableBitrate: this.sessionMaxStableQuality.bitrate,
      });

      this.qualityCeiling = this.sessionMaxStableQuality;
      this.qualityAdjustmentInProgress = true;

      if (typeof this.player?.setQuality === 'function') {
        this.player.setQuality(this.sessionMaxStableQuality);
      }
      if (typeof this.player?.setAutoQualityMode === 'function') {
        this.player.setAutoQualityMode(false);
      }

      this.showQualityAdjustmentNotification(
        `Optimizing for your connection`
      );

      this.consecutiveStalls = 0;
      this.scheduleQualityRecovery();
      return;
    }

    // Find next lower quality from current ceiling (or current quality if no ceiling)
    const referenceQuality = this.qualityCeiling || currentQuality;
    const lowerQualities = sortedQualities.filter((q: any) => q.bitrate < referenceQuality.bitrate);

    if (lowerQualities.length === 0) {
      this.logDiagnostic('state', 'Already at lowest quality - cannot lower further');
      return;
    }

    // Set the new ceiling to the next lower quality
    const newCeiling = lowerQualities[0];
    this.qualityCeiling = newCeiling;
    this.qualityAdjustmentInProgress = true;

    this.logDiagnostic('state', `Quality ceiling lowered to: ${newCeiling.name} (${(newCeiling.bitrate / 1000000).toFixed(1)} Mbps)`, {
      previousCeiling: referenceQuality.name,
      newCeiling: newCeiling.name,
    });

    // Force switch to the new ceiling quality
    if (typeof this.player?.setQuality === 'function') {
      this.player.setQuality(newCeiling);
    }

    // Disable auto quality to enforce the ceiling temporarily
    if (typeof this.player?.setAutoQualityMode === 'function') {
      this.player.setAutoQualityMode(false);
    }

    // Show notification to user
    this.showQualityAdjustmentNotification(
      `Adjusting video quality for smoother playback`
    );

    // Reset consecutive stalls since we took action
    this.consecutiveStalls = 0;

    // Schedule progressive recovery to try higher quality later
    this.scheduleQualityRecovery();
  }

  /**
   * Schedule an attempt to recover to higher quality after stable playback.
   * Uses progressive timing: 30s → 60s → 120s
   */
  private scheduleQualityRecovery(): void {
    const waitTime = this.recoveryWaitTimes[Math.min(this.currentRecoveryWaitIndex, this.recoveryWaitTimes.length - 1)];
    this.lastRecoveryAttemptTime = Date.now();

    this.logDiagnostic('state', `Quality recovery scheduled in ${waitTime / 1000}s`, {
      recoveryIndex: this.currentRecoveryWaitIndex,
      waitTimeSeconds: waitTime / 1000,
    });

    // Clear any existing recovery timer
    if (this.stallRecoveryTimer) {
      clearTimeout(this.stallRecoveryTimer);
    }

    this.stallRecoveryTimer = setTimeout(() => {
      this.attemptQualityRecovery();
    }, waitTime);
  }

  /**
   * Attempt to recover to a higher quality level after stable playback.
   */
  private attemptQualityRecovery(): void {
    if (!this.qualityCeiling || !this.player) return;

    const qualities = this.player.getQualities?.() || [];
    const currentQuality = this.player.getQuality?.();

    // Check if playback has been stable (no stalls in the recovery period)
    const timeSinceLastStall = Date.now() - this.lastStallRecoveryTime;
    const minStableTime = this.recoveryWaitTimes[Math.min(this.currentRecoveryWaitIndex, this.recoveryWaitTimes.length - 1)];

    if (timeSinceLastStall < minStableTime) {
      this.logDiagnostic('state', 'Playback not stable enough for quality recovery', {
        timeSinceLastStall: (timeSinceLastStall / 1000).toFixed(0),
        requiredStableTime: (minStableTime / 1000).toFixed(0),
      });
      // Reschedule with increased wait time
      this.currentRecoveryWaitIndex = Math.min(this.currentRecoveryWaitIndex + 1, this.recoveryWaitTimes.length - 1);
      this.scheduleQualityRecovery();
      return;
    }

    // Find next higher quality above current ceiling
    const sortedQualities = [...qualities].sort((a: any, b: any) => a.bitrate - b.bitrate);
    const higherQualities = sortedQualities.filter((q: any) => q.bitrate > this.qualityCeiling.bitrate);

    if (higherQualities.length === 0) {
      // Already at max quality - remove ceiling entirely
      this.logDiagnostic('state', 'Quality ceiling removed - at maximum quality');
      this.qualityCeiling = null;
      this.currentRecoveryWaitIndex = 0;

      // Re-enable auto quality
      if (typeof this.player.setAutoQualityMode === 'function') {
        this.player.setAutoQualityMode(true);
      }
      return;
    }

    // Try the next higher quality
    const newCeiling = higherQualities[0];
    const previousCeiling = this.qualityCeiling;
    this.qualityCeiling = newCeiling;

    this.logDiagnostic('state', `Attempting quality recovery: ${previousCeiling.name} → ${newCeiling.name}`, {
      previousBitrate: previousCeiling.bitrate,
      newBitrate: newCeiling.bitrate,
    });

    // Allow ABR to select up to the new ceiling
    if (typeof this.player.setQuality === 'function') {
      this.player.setQuality(newCeiling);
    }

    // Re-enable auto quality mode with the new ceiling as maximum
    if (typeof this.player.setAutoQualityMode === 'function') {
      this.player.setAutoQualityMode(true);
    }

    // Show brief notification
    this.showQualityAdjustmentNotification(
      `Improving video quality`
    );

    // Reduce wait time for next recovery (playback was stable)
    this.currentRecoveryWaitIndex = Math.max(0, this.currentRecoveryWaitIndex - 1);

    // Schedule next recovery attempt to potentially go even higher
    this.scheduleQualityRecovery();
  }

  /**
   * Track quality stability - when quality plays without issues for a threshold period,
   * remember it as the session's known-good quality.
   */
  private updateStableQualityTracking(): void {
    if (!this.player) return;

    const currentQuality = this.player.getQuality?.();
    if (!currentQuality) return;

    const now = Date.now();

    // If quality changed, reset stable playback timer
    if (currentQuality.bitrate !== this.currentQualityBitrate) {
      this.currentQualityBitrate = currentQuality.bitrate;
      this.stablePlaybackStartTime = now;
      this.lastQualityChangeTime = now;
      return;
    }

    // Check if current quality has been stable for the threshold period
    if (this.stablePlaybackStartTime > 0) {
      const stableDuration = now - this.stablePlaybackStartTime;

      if (stableDuration >= this.qualityStableThreshold) {
        // This quality has been stable - remember it
        if (!this.sessionMaxStableQuality || currentQuality.bitrate > this.sessionMaxStableQuality.bitrate) {
          this.sessionMaxStableQuality = currentQuality;
          this.logDiagnostic('quality', `Session max stable quality updated: ${currentQuality.name}`, {
            bitrate: currentQuality.bitrate,
            stableDuration: (stableDuration / 1000).toFixed(0),
          });
        }
      }
    }
  }

  /**
   * Show a brief notification to the user about quality adjustment.
   * Disappears after 3 seconds.
   */
  private showQualityAdjustmentNotification(message: string): void {
    // Clear any existing notification timer
    if (this.qualityNotificationTimer) {
      clearTimeout(this.qualityNotificationTimer);
    }

    this.qualityNotificationMessage = message;
    this.showQualityNotification = true;
    this.cdr.detectChanges();

    // Auto-hide after 3 seconds
    this.qualityNotificationTimer = setTimeout(() => {
      this.showQualityNotification = false;
      this.cdr.detectChanges();
    }, 3000);
  }

  private startCommentsRefresh() {
    if (this.commentsTimer) {
      clearInterval(this.commentsTimer);
    }

    // Refresh comments every 5 seconds
    this.commentsTimer = setInterval(async () => {
      if (!this.eventId) return;
      try {
        const newComments = await this.eventsApi.listComments(this.eventId);
        this.ngZone.run(() => {
          this.comments = newComments;
        });
      } catch {
        // Silently fail on comment refresh
      }
    }, 5000);
  }

  private startViewerCountPolling() {
    if (this.viewerCountTimer) {
      clearInterval(this.viewerCountTimer);
    }

    // Poll viewer count from IVS every 10 seconds
    this.viewerCountTimer = setInterval(async () => {
      if (!this.eventId) return;
      try {
        const status = await this.eventsApi.getStreamStatus(this.eventId);
        this.ngZone.run(() => {
          this.viewerCount = status.viewerCount;
        });
      } catch {
        // Silently fail on viewer count
      }
    }, 10000);

    // Initial fetch
    if (this.eventId) {
      this.eventsApi.getStreamStatus(this.eventId).then(status => {
        this.ngZone.run(() => {
          this.viewerCount = status.viewerCount;
        });
      }).catch(() => {});
    }
  }

  private getErrorMessage(error: any): string {
    if (!error) return 'An unexpected error occurred';

    // Handle specific error types
    if (error?.message?.includes('No valid ticket')) {
      return 'You need a valid ticket to watch this event';
    }
    if (error?.message?.includes('not supported')) {
      return 'Your browser does not support video playback. Please try a different browser.';
    }

    return 'Unable to load the stream. Please try again.';
  }

  /**
   * Determine if an error is transient and should be auto-retried.
   * Network errors, temporary failures, and certain player errors can be recovered.
   */
  private shouldAutoRetry(errorCode: string): boolean {
    // Don't retry if we've exceeded max retries
    if (this.errorRetryCount >= this.maxErrorRetries) {
      this.logDiagnostic('error', `Max retries (${this.maxErrorRetries}) exceeded, not retrying`);
      return false;
    }

    // Don't retry if errors are happening too frequently (< 5 seconds apart)
    const now = Date.now();
    if (this.lastErrorTime > 0 && (now - this.lastErrorTime) < 5000) {
      this.logDiagnostic('error', 'Errors occurring too frequently, not retrying');
      return false;
    }
    this.lastErrorTime = now;

    // Transient error codes that can be retried
    const retryableErrors = [
      'NetworkError',
      'NETWORK_ERROR',
      'TIMEOUT',
      'MEDIA_ERR_NETWORK',
      'MEDIA_ERR_DECODE',
      'MEDIA_ERR_SRC_NOT_SUPPORTED', // Sometimes temporary during manifest updates
    ];

    // Check if error code matches retryable errors
    const isRetryable = retryableErrors.some(e =>
      errorCode.toUpperCase().includes(e.toUpperCase())
    );

    return isRetryable;
  }

  /**
   * Attempt to recover from a transient error by reloading the player.
   * Uses the pre-fetched token URL if available, otherwise fetches a new one.
   */
  private async attemptErrorRecovery(): Promise<void> {
    this.errorRetryCount++;
    const retryDelay = Math.min(1000 * Math.pow(2, this.errorRetryCount - 1), 10000); // Exponential backoff, max 10s

    this.logDiagnostic('state', `Attempting error recovery (${this.errorRetryCount}/${this.maxErrorRetries})`, {
      retryDelay,
      hasCachedToken: !!this.cachedTokenUrl,
    });

    // Clear any existing retry timer
    if (this.errorRetryTimer) {
      clearTimeout(this.errorRetryTimer);
    }

    this.errorRetryTimer = setTimeout(async () => {
      if (!this.eventId || !this.playbackUrl || !this.player) {
        this.logDiagnostic('error', 'Cannot recover - missing required state');
        this.streamStatus = 'error';
        this.errorMessage = 'Playback failed. Please reload the page.';
        return;
      }

      try {
        let urlWithToken: string;
        let expiresAt: string;

        // Use cached token if available, otherwise fetch new one
        if (this.cachedTokenUrl) {
          urlWithToken = this.cachedTokenUrl;
          expiresAt = this.tokenExpiresAt; // Use existing expiry
          this.logDiagnostic('state', 'Using cached token for recovery');
        } else {
          const tokenResult = await this.ivsApi.getPlaybackToken(this.eventId);
          urlWithToken = `${this.playbackUrl}?token=${encodeURIComponent(tokenResult.token)}`;
          expiresAt = tokenResult.expiresAt;
          this.logDiagnostic('state', 'Fetched new token for recovery');
        }

        this.player.load(urlWithToken);
        await this.player.play();

        // Success - reset error state
        this.errorRetryCount = 0;
        this.lastErrorTime = 0;
        this.errorMessage = '';

        this.logDiagnostic('state', 'Error recovery successful');

        // Re-schedule token pre-fetch
        this.scheduleRefresh(this.eventId, this.playbackUrl, expiresAt);
      } catch (err: any) {
        this.logDiagnostic('error', `Error recovery failed: ${err?.message}`);

        // If we still have retries left, the next error will trigger another attempt
        if (this.errorRetryCount >= this.maxErrorRetries) {
          this.streamStatus = 'error';
          this.errorMessage = 'Unable to recover playback. Please reload the page.';
        }
      }
    }, retryDelay);
  }

  /**
   * Configure video element with optimal settings for live streaming.
   * Sets preload hints and other attributes for better playback stability.
   */
  private configureVideoElement(): void {
    const videoEl = this.videoElRef?.nativeElement;
    if (!videoEl) return;

    // Preload metadata to speed up initial load
    videoEl.preload = 'auto';

    // Disable picture-in-picture to prevent unexpected behavior during live streams
    if ('disablePictureInPicture' in videoEl) {
      (videoEl as any).disablePictureInPicture = false; // Allow PiP for user convenience
    }

    // Set crossorigin for CORS-enabled streams
    videoEl.crossOrigin = 'anonymous';

    // Disable remote playback (casting) to prevent sync issues during live streams
    if ('disableRemotePlayback' in videoEl) {
      (videoEl as any).disableRemotePlayback = true;
    }

    this.logDiagnostic('state', 'Video element configured', {
      preload: videoEl.preload,
      crossOrigin: videoEl.crossOrigin,
    });
  }

  /**
   * Verify user has access to watch this paid event.
   * Returns true if: admin OR has paid ticket OR event is covered by season ticket.
   */
  private async verifyAccess(): Promise<boolean> {
    // Admin has unrestricted access
    if (this.isAdmin) return true;

    if (!this.eventId) return false;

    try {
      const access = await this.eventsApi.getAccess(this.eventId);
      this.hasPaidTicket = access.hasPaidTicket;
      this.hasSeasonTicket = access.hasSeasonTicket || false;
      this.seasonTicketPurchasedAt = access.seasonTicketPurchasedAt || null;

      // Has individual ticket for this event
      if (this.hasPaidTicket) return true;

      // Check if event is covered by season ticket
      if (this.hasSeasonTicket && this.seasonTicketPurchasedAt && this.event) {
        const eventStartDate = new Date(this.event.starts_at);
        const seasonPurchaseDate = new Date(this.seasonTicketPurchasedAt);
        if (eventStartDate >= seasonPurchaseDate) {
          return true;
        }
      }

      return false;
    } catch {
      return false;
    }
  }

  // ==================== DIAGNOSTIC METHODS ====================

  /**
   * Log a diagnostic event to the panel and console.
   * Optimized to reduce overhead - only logs to console for anomalies and important events.
   */
  private logDiagnostic(
    type: DiagnosticEvent['type'],
    message: string,
    data?: Record<string, any>,
    isAnomaly = false
  ): void {
    if (!this.debugMode) return;

    const event: DiagnosticEvent = {
      timestamp: new Date(),
      type,
      message,
      data,
      isAnomaly,
    };

    // Keep last 100 events
    this.diagnosticEvents.unshift(event);
    if (this.diagnosticEvents.length > 100) {
      this.diagnosticEvents.pop();
    }

    if (isAnomaly) {
      this.anomalyCount++;
    }

    // Console logging - only for anomalies and non-metric events to reduce overhead
    // Metric events are too frequent and cause performance issues
    if (isAnomaly || type !== 'metric') {
      const prefix = `[IVS ${type.toUpperCase()}]`;
      const style = isAnomaly ? 'color: red; font-weight: bold' : 'color: #666';
      console.log(`%c${prefix} ${message}`, style, data || '');
    }

    // Only trigger change detection if panel is visible
    if (this.showDiagnosticPanel) {
      this.cdr.detectChanges();
    }
  }

  /**
   * Start periodic metrics sampling (every 1 second)
   * In debug mode: full metrics sampling with UI updates
   * In normal mode: quality stability tracking only (no UI updates)
   */
  private startMetricsSampling(): void {
    if (this.metricsTimer) return;

    this.lastPosition = this.player?.getPosition?.() || 0;
    this.lastPositionTime = Date.now();
    this.stablePlaybackStartTime = Date.now();

    this.metricsTimer = setInterval(() => {
      this.sampleMetrics();
    }, 1000);

    if (this.debugMode) {
      this.logDiagnostic('metric', 'Metrics sampling started (1s interval)');
    }
  }

  /**
   * Sample current player metrics and detect anomalies.
   * In debug mode: full metrics with UI updates and anomaly detection.
   * In normal mode: only quality stability tracking.
   */
  private sampleMetrics(): void {
    if (!this.player) return;

    const videoEl = this.videoElRef?.nativeElement;
    const now = Date.now();

    try {
      const position = this.player.getPosition?.() || 0;
      const quality = this.player.getQuality?.();

      // Always track stable quality for session memory
      this.updateStableQualityTracking();

      // In non-debug mode, skip the rest (no UI updates needed)
      if (!this.debugMode) {
        this.lastPosition = position;
        this.lastPositionTime = now;
        return;
      }

      // Debug mode: full metrics sampling
      const bufferDuration = this.player.getBufferDuration?.() || 0;

      this.currentMetrics = {
        position: Math.round(position * 1000) / 1000,
        bufferDuration: Math.round(bufferDuration * 1000) / 1000,
        quality: quality?.name || 'auto',
        bitrate: quality?.bitrate || 0,
        playbackRate: videoEl?.playbackRate || 1,
        readyState: videoEl?.readyState || 0,
        networkState: videoEl?.networkState || 0,
      };

      // Update token status countdown
      if (this.tokenExpiresAt) {
        const expiresAtMs = new Date(this.tokenExpiresAt).getTime();
        this.tokenStatus.timeUntilRefresh = Math.max(0, Math.round((expiresAtMs - now - 90000) / 1000));
      }

      // Anomaly detection: Position jump
      const expectedPosition = this.lastPosition + (now - this.lastPositionTime) / 1000;
      const positionDelta = Math.abs(position - expectedPosition);

      // Detect position jumps > 0.5s that aren't from user seeking
      if (positionDelta > 0.5 && this.lastPosition > 0) {
        this.logDiagnostic(
          'anomaly',
          `Position jump detected: ${positionDelta.toFixed(2)}s`,
          {
            expected: expectedPosition.toFixed(2),
            actual: position.toFixed(2),
            delta: positionDelta.toFixed(2),
            lastPosition: this.lastPosition.toFixed(2),
          },
          true
        );
      }

      // Anomaly detection: Low buffer
      if (bufferDuration < 2 && bufferDuration > 0) {
        this.logDiagnostic(
          'anomaly',
          `Low buffer warning: ${bufferDuration.toFixed(2)}s`,
          { bufferDuration, position },
          true
        );
      }

      this.lastPosition = position;
      this.lastPositionTime = now;

      // Only update UI if panel is visible (reduces overhead when panel is hidden)
      if (this.showDiagnosticPanel) {
        this.cdr.detectChanges();
      }
    } catch (e) {
      // Silently handle metric sampling errors
    }
  }

  /**
   * Stop metrics sampling
   */
  private stopMetricsSampling(): void {
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = undefined;
      this.logDiagnostic('metric', 'Metrics sampling stopped');
    }
  }

  /**
   * Toggle diagnostic panel visibility
   */
  toggleDiagnosticPanel(): void {
    this.showDiagnosticPanel = !this.showDiagnosticPanel;
  }

  /**
   * Clear diagnostic events log
   */
  clearDiagnosticLog(): void {
    this.diagnosticEvents = [];
    this.anomalyCount = 0;
    this.logDiagnostic('metric', 'Diagnostic log cleared');
  }

  /**
   * Export diagnostic log as JSON
   */
  exportDiagnosticLog(): void {
    const exportData = {
      exportedAt: new Date().toISOString(),
      eventId: this.eventId,
      totalEvents: this.diagnosticEvents.length,
      anomalyCount: this.anomalyCount,
      tokenStatus: this.tokenStatus,
      currentMetrics: this.currentMetrics,
      events: this.diagnosticEvents,
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ivs-diagnostics-${this.eventId}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);

    this.logDiagnostic('metric', 'Diagnostic log exported');
  }

  /**
   * Format timestamp for display
   */
  formatDiagnosticTime(date: Date): string {
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    } as Intl.DateTimeFormatOptions);
  }

  /**
   * Get CSS class for diagnostic event type
   */
  getDiagnosticEventClass(event: DiagnosticEvent): string {
    if (event.isAnomaly) return 'anomaly';
    return event.type;
  }
}
