import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

// Access global cast objects via window
const getChromeCast = (): any => (window as any).chrome?.cast;
const getCastFramework = (): any => (window as any).cast?.framework;
const setGCastCallback = (cb: (available: boolean) => void) => {
  (window as any).__onGCastApiAvailable = cb;
};

export interface CastState {
  isAvailable: boolean;
  isConnected: boolean;
  deviceName: string | null;
  playerState: 'idle' | 'playing' | 'paused' | 'buffering';
}

@Injectable({
  providedIn: 'root'
})
export class ChromecastService {
  private castContext: any = null;
  private remotePlayer: any = null;
  private remotePlayerController: any = null;
  
  private castStateSubject = new BehaviorSubject<CastState>({
    isAvailable: false,
    isConnected: false,
    deviceName: null,
    playerState: 'idle'
  });

  public castState$: Observable<CastState> = this.castStateSubject.asObservable();
  
  private currentMediaUrl: string | null = null;
  private currentMediaTitle: string | null = null;
  private sdkInitialized = false;

  constructor(private ngZone: NgZone) {
    this.initializeCastApi();
  }

  private initializeCastApi(): void {
    // Check if Cast SDK is already loaded
    if (getCastFramework()) {
      this.setupCastApi();
      return;
    }

    // Wait for Cast SDK to load
    setGCastCallback((isAvailable: boolean) => {
      if (isAvailable) {
        this.ngZone.run(() => {
          this.setupCastApi();
        });
      }
    });
  }

  private setupCastApi(): void {
    if (this.sdkInitialized) return;
    
    try {
      const castFramework = getCastFramework();
      const chromeCast = getChromeCast();
      
      if (!castFramework) {
        console.warn('[Chromecast] Cast framework not available');
        return;
      }
      
      if (!chromeCast) {
        console.warn('[Chromecast] Chrome Cast API not available');
        return;
      }

      this.castContext = castFramework.CastContext.getInstance();
      
      // Configure Cast options - use string values as fallback if enums not available
      const receiverAppId = chromeCast.media?.DEFAULT_MEDIA_RECEIVER_APP_ID || 'CC1AD845';
      const autoJoinPolicy = chromeCast.AutoJoinPolicy?.ORIGIN_SCOPED || 'origin_scoped';
      
      this.castContext.setOptions({
        receiverApplicationId: receiverAppId,
        autoJoinPolicy: autoJoinPolicy
      });

      // Create remote player and controller
      this.remotePlayer = new castFramework.RemotePlayer();
      this.remotePlayerController = new castFramework.RemotePlayerController(this.remotePlayer);

      // Listen for cast state changes
      this.castContext.addEventListener(
        castFramework.CastContextEventType.CAST_STATE_CHANGED,
        (event: any) => {
          this.ngZone.run(() => {
            this.handleCastStateChange(event);
          });
        }
      );

      // Listen for session state changes
      this.castContext.addEventListener(
        castFramework.CastContextEventType.SESSION_STATE_CHANGED,
        (event: any) => {
          this.ngZone.run(() => {
            this.handleSessionStateChange(event);
          });
        }
      );

      // Listen for remote player changes
      this.remotePlayerController.addEventListener(
        castFramework.RemotePlayerEventType.IS_CONNECTED_CHANGED,
        () => {
          this.ngZone.run(() => {
            this.updateCastState();
          });
        }
      );

      this.remotePlayerController.addEventListener(
        castFramework.RemotePlayerEventType.PLAYER_STATE_CHANGED,
        () => {
          this.ngZone.run(() => {
            this.updatePlayerState();
          });
        }
      );

      this.sdkInitialized = true;
      this.updateCastState();
      console.log('[Chromecast] Cast API initialized successfully');
      
    } catch (error) {
      console.error('[Chromecast] Failed to initialize Cast API:', error);
    }
  }

  private handleCastStateChange(event: any): void {
    const castFramework = getCastFramework();
    if (!castFramework) return;

    const isAvailable = event.castState !== castFramework.CastState.NO_DEVICES_AVAILABLE;
    
    this.castStateSubject.next({
      ...this.castStateSubject.value,
      isAvailable
    });
  }

  private handleSessionStateChange(event: any): void {
    const castFramework = getCastFramework();
    if (!castFramework) return;

    const isConnected = event.sessionState === castFramework.SessionState.SESSION_STARTED ||
                        event.sessionState === castFramework.SessionState.SESSION_RESUMED;
    
    let deviceName: string | null = null;
    if (isConnected) {
      const session = this.castContext?.getCurrentSession();
      deviceName = session?.getCastDevice()?.friendlyName || 'Chromecast';
    }

    this.castStateSubject.next({
      ...this.castStateSubject.value,
      isConnected,
      deviceName
    });

    // If we just connected and have media queued, load it
    if (isConnected && this.currentMediaUrl) {
      this.loadMedia(this.currentMediaUrl, this.currentMediaTitle || 'Live Stream');
    }
  }

  private updateCastState(): void {
    if (!this.remotePlayer || !this.castContext) return;

    const castFramework = getCastFramework();
    if (!castFramework) return;

    const castState = this.castContext.getCastState();
    const isAvailable = castState !== castFramework.CastState.NO_DEVICES_AVAILABLE;
    const isConnected = this.remotePlayer.isConnected;
    
    let deviceName: string | null = null;
    if (isConnected) {
      const session = this.castContext.getCurrentSession();
      deviceName = session?.getCastDevice()?.friendlyName || 'Chromecast';
    }

    this.castStateSubject.next({
      ...this.castStateSubject.value,
      isAvailable,
      isConnected,
      deviceName
    });
  }

  private updatePlayerState(): void {
    if (!this.remotePlayer) return;

    let playerState: CastState['playerState'] = 'idle';
    const chromeCast = getChromeCast();
    
    if (this.remotePlayer.playerState && chromeCast) {
      switch (this.remotePlayer.playerState) {
        case chromeCast.media?.PlayerState?.PLAYING:
          playerState = 'playing';
          break;
        case chromeCast.media?.PlayerState?.PAUSED:
          playerState = 'paused';
          break;
        case chromeCast.media?.PlayerState?.BUFFERING:
          playerState = 'buffering';
          break;
        default:
          playerState = 'idle';
      }
    }

    this.castStateSubject.next({
      ...this.castStateSubject.value,
      playerState
    });
  }

  /**
   * Check if Chromecast is available (devices found)
   */
  get isAvailable(): boolean {
    return this.castStateSubject.value.isAvailable;
  }

  /**
   * Check if currently connected to a Cast device
   */
  get isConnected(): boolean {
    return this.castStateSubject.value.isConnected;
  }

  /**
   * Get current cast state
   */
  get currentState(): CastState {
    return this.castStateSubject.value;
  }

  /**
   * Open the Cast device picker dialog
   */
  async openCastDialog(): Promise<void> {
    if (!this.castContext) {
      console.warn('[Chromecast] Cast context not initialized');
      return;
    }

    try {
      await this.castContext.requestSession();
    } catch (error: any) {
      if (error?.code !== 'cancel') {
        console.error('[Chromecast] Failed to open cast dialog:', error);
      }
    }
  }

  /**
   * Load media to the connected Cast device
   */
  async loadMedia(url: string, title: string, isLive: boolean = false): Promise<boolean> {
    this.currentMediaUrl = url;
    this.currentMediaTitle = title;

    if (!this.castContext) {
      console.warn('[Chromecast] Cast context not initialized');
      return false;
    }

    const session = this.castContext.getCurrentSession();
    if (!session) {
      console.warn('[Chromecast] No active cast session');
      return false;
    }

    try {
      const chromeCast = getChromeCast();
      if (!chromeCast) {
        console.warn('[Chromecast] Chrome cast not available');
        return false;
      }

      console.log('[Chromecast] Loading media URL:', url);

      // Use 'application/vnd.apple.mpegurl' for better HLS compatibility
      const mediaInfo = new chromeCast.media.MediaInfo(url, 'application/vnd.apple.mpegurl');
      mediaInfo.metadata = new chromeCast.media.GenericMediaMetadata();
      mediaInfo.metadata.title = title;
      
      // Set stream type based on live/VOD
      mediaInfo.streamType = isLive 
        ? chromeCast.media.StreamType.LIVE 
        : chromeCast.media.StreamType.BUFFERED;

      // Set HLS segment format for better compatibility
      mediaInfo.hlsSegmentFormat = chromeCast.media.HlsSegmentFormat?.TS;
      mediaInfo.hlsVideoSegmentFormat = chromeCast.media.HlsVideoSegmentFormat?.MPEG2_TS;

      const request = new chromeCast.media.LoadRequest(mediaInfo);
      request.autoplay = true;

      console.log('[Chromecast] Sending load request:', request);
      const result = await session.loadMedia(request);
      console.log('[Chromecast] Media loaded successfully, result:', result);
      return true;
      
    } catch (error: any) {
      console.error('[Chromecast] Failed to load media:', error);
      console.error('[Chromecast] Error details:', {
        code: error?.code,
        description: error?.description,
        message: error?.message
      });
      return false;
    }
  }

  /**
   * Play/resume media on Cast device
   */
  play(): void {
    if (this.remotePlayerController && this.remotePlayer?.isPaused) {
      this.remotePlayerController.playOrPause();
    }
  }

  /**
   * Pause media on Cast device
   */
  pause(): void {
    if (this.remotePlayerController && !this.remotePlayer?.isPaused) {
      this.remotePlayerController.playOrPause();
    }
  }

  /**
   * Stop casting and disconnect
   */
  stopCasting(): void {
    if (this.castContext) {
      const session = this.castContext.getCurrentSession();
      if (session) {
        session.endSession(true);
      }
    }
    this.currentMediaUrl = null;
    this.currentMediaTitle = null;
  }

  /**
   * Seek to a specific time (in seconds)
   */
  seekTo(time: number): void {
    if (this.remotePlayer && this.remotePlayerController) {
      this.remotePlayer.currentTime = time;
      this.remotePlayerController.seek();
    }
  }

  /**
   * Set volume (0-1)
   */
  setVolume(volume: number): void {
    if (this.remotePlayer && this.remotePlayerController) {
      this.remotePlayer.volumeLevel = Math.max(0, Math.min(1, volume));
      this.remotePlayerController.setVolumeLevel();
    }
  }

  /**
   * Toggle mute
   */
  toggleMute(): void {
    if (this.remotePlayerController) {
      this.remotePlayerController.muteOrUnmute();
    }
  }

  /**
   * Get current playback position (in seconds)
   */
  getCurrentTime(): number {
    return this.remotePlayer?.currentTime || 0;
  }

  /**
   * Get media duration (in seconds)
   */
  getDuration(): number {
    return this.remotePlayer?.duration || 0;
  }
}
