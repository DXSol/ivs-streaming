import { Component, ElementRef, OnDestroy, OnInit, ViewChild, NgZone } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DatePipe, NgFor, NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
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
  Platform,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { homeOutline } from 'ionicons/icons';
import { Subscription } from 'rxjs';

import { IvsPlayerService } from '../services/ivs-player.service';
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
    NgIf,
    NgFor,
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
  private resumeSubscription?: Subscription;
  private pauseSubscription?: Subscription;

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
    private platform: Platform
  ) {
    addIcons({ homeOutline });
    
    // Listen for app resume (coming back from background)
    this.resumeSubscription = this.platform.resume.subscribe(() => {
      this.ngZone.run(() => {
        this.onAppResume();
      });
    });
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
      
      

      try {
        
        this.player = await this.ivsPlayer.createAndAttachPlayer(
          this.videoElRef.nativeElement,
          urlWithToken
        );
        
      } catch (playerError) {
        
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

  /**
   * Handle app resume from background.
   * Attempts to resume video playback when user returns to the app.
   */
  private async onAppResume(): Promise<void> {
    console.log('[Watch] App resumed from background');
    
    // Only attempt to resume if we have a player and were playing
    if (!this.player || !this.videoElRef?.nativeElement) return;
    
    const video = this.videoElRef.nativeElement;
    const wasPlaying = this.streamStatus === 'live' || this.streamStatus === 'recording';
    
    if (wasPlaying) {
      try {
        // For IVS player, we may need to reload the stream
        if (video.paused) {
          console.log('[Watch] Attempting to resume playback...');
          await this.player.play();
        }
      } catch (err) {
        console.error('[Watch] Failed to resume on app resume:', err);
        // If play fails, try reloading the stream
        if (this.playbackUrl && !this.isRecordingMode && this.eventId) {
          try {
            console.log('[Watch] Reloading stream with fresh token...');
            const { token, expiresAt } = await this.ivsApi.getPlaybackToken(this.eventId);
            const urlWithToken = `${this.playbackUrl}?token=${encodeURIComponent(token)}`;
            this.player.load(urlWithToken);
            await this.player.play();
            this.scheduleRefresh(this.eventId, this.playbackUrl, expiresAt);
          } catch (reloadErr) {
            console.error('[Watch] Failed to reload stream:', reloadErr);
          }
        } else if (this.isRecordingMode && this.playbackUrl) {
          try {
            console.log('[Watch] Reloading recording...');
            const currentTime = video.currentTime;
            this.player.load(this.playbackUrl);
            video.currentTime = currentTime;
            await this.player.play();
          } catch (reloadErr) {
            console.error('[Watch] Failed to reload recording:', reloadErr);
          }
        }
      }
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

  private scheduleRefresh(eventId: string, playbackUrl: string, expiresAtIso: string) {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }

    const expiresAt = new Date(expiresAtIso).getTime();
    const now = Date.now();

    // Refresh ~90 seconds before expiry; min 30s.
    const delayMs = Math.max(30_000, expiresAt - now - 90_000);

    this.refreshTimer = setTimeout(async () => {
      try {
        const { token, expiresAt: nextExpires } = await this.ivsApi.getPlaybackToken(eventId);
        const urlWithToken = `${playbackUrl}?token=${encodeURIComponent(token)}`;

        // Reload the playlist with a fresh token.
        if (this.player?.load) {
          this.player.load(urlWithToken);
          await this.player.play();
        }

        this.scheduleRefresh(eventId, playbackUrl, nextExpires);
      } catch {
        // If refresh fails, user can re-open watch page.
        this.errorMessage = 'Session expired. Please reopen the stream.';
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
    if (this.resumeSubscription) {
      this.resumeSubscription.unsubscribe();
      this.resumeSubscription = undefined;
    }
    if (this.pauseSubscription) {
      this.pauseSubscription.unsubscribe();
      this.pauseSubscription = undefined;
    }
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
      this.player.addEventListener(PlayerEventType.STATE_CHANGED, (state: string) => {
        this.ngZone.run(() => {
          switch (state) {
            case PlayerState.PLAYING:
              // Show 'recording' status for recordings, 'live' for live streams
              this.streamStatus = this.isRecordingMode ? 'recording' : 'live';
              this.errorMessage = '';
              break;
            case PlayerState.ENDED:
              // Stream/recording has ended
              if (this.isRecordingMode && this.currentSessionIndex < this.totalSessions - 1) {
                // Auto-play next session
                this.playNextSession();
              } else {
                this.streamStatus = this.isRecordingMode ? 'ended' : 'offline';
              }
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
              break;
          }
        });
      });

      this.player.addEventListener(PlayerEventType.ERROR, (err: any) => {
        this.ngZone.run(() => {
          this.streamStatus = 'error';
          this.errorMessage = this.getErrorMessage(err);
        });
      });
    }
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
}
