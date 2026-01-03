import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { VideoPlayer } from '@capgo/capacitor-video-player';

export interface VideoPlayerConfig {
  url: string;
  playerId?: string;
  autoplay?: boolean;
  muted?: boolean;
}

export interface VideoPlayerState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
}

@Injectable({
  providedIn: 'root'
})
export class NativeVideoPlayerService {
  private playerId = 'ivs-native-player';
  private isNativePlatform = false;

  constructor() {
    this.isNativePlatform = Capacitor.isNativePlatform();
  }

  /**
   * Check if we should use native player (Android/iOS) or web player
   */
  shouldUseNativePlayer(): boolean {
    return this.isNativePlatform;
  }

  /**
   * Initialize and play video using native player (ExoPlayer/AVPlayer)
   */
  async initPlayer(config: VideoPlayerConfig): Promise<void> {
    if (!this.isNativePlatform) {
      throw new Error('Native player only available on Android/iOS');
    }

    const playerId = config.playerId || this.playerId;

    try {
      // Initialize the native player in fullscreen mode (embedded not supported on Android/iOS)
      await VideoPlayer.initPlayer({
        mode: 'fullscreen',
        url: config.url,
        playerId: playerId,
        showControls: true,
        bkmodeEnabled: true, // Enable background mode for audio continuation
        pipEnabled: false, // Disable PiP
        exitOnEnd: false, // Don't exit when video ends - return to app instead
        loopOnEnd: false,
        displayMode: 'all', // Support both portrait and landscape
        chromecast: true, // Enable Chromecast support
      });

      console.log('[NativeVideoPlayer] Player initialized:', playerId);

      // Auto-play if requested
      if (config.autoplay !== false) {
        await this.play(playerId);
      }

      // Set volume
      if (!config.muted) {
        await this.setVolume(1.0, playerId);
      }
    } catch (error) {
      console.error('[NativeVideoPlayer] Failed to initialize player:', error);
      throw error;
    }
  }

  /**
   * Play video
   */
  async play(playerId?: string): Promise<void> {
    const id = playerId || this.playerId;
    try {
      await VideoPlayer.play({ playerId: id });
      console.log('[NativeVideoPlayer] Playing:', id);
    } catch (error) {
      console.error('[NativeVideoPlayer] Failed to play:', error);
      throw error;
    }
  }

  /**
   * Pause video
   */
  async pause(playerId?: string): Promise<void> {
    const id = playerId || this.playerId;
    try {
      await VideoPlayer.pause({ playerId: id });
      console.log('[NativeVideoPlayer] Paused:', id);
    } catch (error) {
      console.error('[NativeVideoPlayer] Failed to pause:', error);
      throw error;
    }
  }

  /**
   * Set volume (0.0 to 1.0)
   */
  async setVolume(volume: number, playerId?: string): Promise<void> {
    const id = playerId || this.playerId;
    try {
      await VideoPlayer.setVolume({ 
        playerId: id, 
        volume: Math.max(0, Math.min(1, volume))
      });
    } catch (error) {
      console.error('[NativeVideoPlayer] Failed to set volume:', error);
    }
  }

  /**
   * Seek to specific time (in seconds)
   */
  async seekTo(time: number, playerId?: string): Promise<void> {
    const id = playerId || this.playerId;
    try {
      await VideoPlayer.setCurrentTime({ 
        playerId: id, 
        seektime: time 
      });
      console.log('[NativeVideoPlayer] Seeked to:', time);
    } catch (error) {
      console.error('[NativeVideoPlayer] Failed to seek:', error);
      throw error;
    }
  }

  /**
   * Get current playback state
   */
  async getCurrentTime(playerId?: string): Promise<number> {
    const id = playerId || this.playerId;
    try {
      const result = await VideoPlayer.getCurrentTime({ playerId: id });
      return result.value || 0;
    } catch (error) {
      console.error('[NativeVideoPlayer] Failed to get current time:', error);
      return 0;
    }
  }

  /**
   * Get video duration
   */
  async getDuration(playerId?: string): Promise<number> {
    const id = playerId || this.playerId;
    try {
      const result = await VideoPlayer.getDuration({ playerId: id });
      return result.value || 0;
    } catch (error) {
      console.error('[NativeVideoPlayer] Failed to get duration:', error);
      return 0;
    }
  }

  /**
   * Stop and cleanup player
   */
  async stopPlayer(playerId?: string): Promise<void> {
    const id = playerId || this.playerId;
    try {
      await VideoPlayer.stopAllPlayers();
      console.log('[NativeVideoPlayer] Player stopped:', id);
    } catch (error) {
      console.error('[NativeVideoPlayer] Failed to stop player:', error);
    }
  }

  /**
   * Check if player is playing
   */
  async isPlaying(playerId?: string): Promise<boolean> {
    const id = playerId || this.playerId;
    try {
      const result = await VideoPlayer.isPlaying({ playerId: id });
      return result.value || false;
    } catch (error) {
      console.error('[NativeVideoPlayer] Failed to check playing state:', error);
      return false;
    }
  }
}
