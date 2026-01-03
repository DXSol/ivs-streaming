import { Injectable } from '@angular/core';
import { Capacitor, registerPlugin } from '@capacitor/core';

export interface IvsVideoPlayerPlugin {
  initialize(options: { url: string; playerId?: string; autoplay?: boolean }): Promise<{ success: boolean }>;
  play(): Promise<{ success: boolean }>;
  pause(): Promise<{ success: boolean }>;
  toggleFullscreen(): Promise<{ success: boolean; isFullscreen: boolean }>;
  destroy(): Promise<{ success: boolean }>;
  getCurrentTime(): Promise<{ currentTime: number }>;
  getDuration(): Promise<{ duration: number }>;
  seekTo(options: { seekTime: number }): Promise<{ success: boolean }>;
  handleBackPress(): Promise<{ handled: boolean }>;
  setPlayerBounds(options: { x: number; y: number; width: number; height: number }): Promise<{ success: boolean }>;
  showBadge(options: { text: string; isLive: boolean }): Promise<{ success: boolean }>;
  hideBadge(): Promise<{ success: boolean }>;
}

const IvsVideoPlayer = registerPlugin<IvsVideoPlayerPlugin>('IvsVideoPlayer');

@Injectable({
  providedIn: 'root'
})
export class IvsVideoPlayerService {
  private isNativePlatform = false;

  constructor() {
    this.isNativePlatform = Capacitor.isNativePlatform();
  }

  shouldUseNativePlayer(): boolean {
    return this.isNativePlatform;
  }

  async initialize(url: string, playerId: string = 'ivs-native-player', autoplay: boolean = true): Promise<void> {
    if (!this.isNativePlatform) {
      throw new Error('Native player only available on Android/iOS');
    }

    try {
      await IvsVideoPlayer.initialize({ url, playerId, autoplay });
      console.log('[IvsVideoPlayer] Player initialized successfully');
    } catch (error) {
      console.error('[IvsVideoPlayer] Failed to initialize:', error);
      throw error;
    }
  }

  async play(): Promise<void> {
    if (!this.isNativePlatform) return;
    
    try {
      await IvsVideoPlayer.play();
    } catch (error) {
      console.error('[IvsVideoPlayer] Failed to play:', error);
      throw error;
    }
  }

  async pause(): Promise<void> {
    if (!this.isNativePlatform) return;
    
    try {
      await IvsVideoPlayer.pause();
    } catch (error) {
      console.error('[IvsVideoPlayer] Failed to pause:', error);
      throw error;
    }
  }

  async toggleFullscreen(): Promise<boolean> {
    if (!this.isNativePlatform) return false;
    
    try {
      const result = await IvsVideoPlayer.toggleFullscreen();
      return result.isFullscreen;
    } catch (error) {
      console.error('[IvsVideoPlayer] Failed to toggle fullscreen:', error);
      throw error;
    }
  }

  async destroy(): Promise<void> {
    if (!this.isNativePlatform) return;
    
    try {
      await IvsVideoPlayer.destroy();
      console.log('[IvsVideoPlayer] Player destroyed');
    } catch (error) {
      console.error('[IvsVideoPlayer] Failed to destroy:', error);
      throw error;
    }
  }

  async getCurrentTime(): Promise<number> {
    if (!this.isNativePlatform) return 0;
    
    try {
      const result = await IvsVideoPlayer.getCurrentTime();
      return result.currentTime;
    } catch (error) {
      console.error('[IvsVideoPlayer] Failed to get current time:', error);
      return 0;
    }
  }

  async getDuration(): Promise<number> {
    if (!this.isNativePlatform) return 0;
    
    try {
      const result = await IvsVideoPlayer.getDuration();
      return result.duration;
    } catch (error) {
      console.error('[IvsVideoPlayer] Failed to get duration:', error);
      return 0;
    }
  }

  async seekTo(timeMs: number): Promise<void> {
    if (!this.isNativePlatform) return;
    
    try {
      await IvsVideoPlayer.seekTo({ seekTime: timeMs });
    } catch (error) {
      console.error('[IvsVideoPlayer] Failed to seek:', error);
      throw error;
    }
  }

  async isPlaying(): Promise<boolean> {
    // This would need to be implemented in the native plugin if needed
    // For now, we track state on the TypeScript side
    return false;
  }

  async handleBackPress(): Promise<boolean> {
    if (!this.isNativePlatform) return false;
    
    try {
      const result = await IvsVideoPlayer.handleBackPress();
      return result.handled;
    } catch (error) {
      console.error('[IvsVideoPlayer] Failed to handle back press:', error);
      return false;
    }
  }

  async setPlayerBounds(x: number, y: number, width: number, height: number): Promise<void> {
    if (!this.isNativePlatform) return;
    
    try {
      await IvsVideoPlayer.setPlayerBounds({ x, y, width, height });
    } catch (error) {
      console.error('[IvsVideoPlayer] Failed to set player bounds:', error);
    }
  }

  async showBadge(text: string, isLive: boolean): Promise<void> {
    if (!this.isNativePlatform) return;
    
    try {
      await IvsVideoPlayer.showBadge({ text, isLive });
    } catch (error) {
      console.error('[IvsVideoPlayer] Failed to show badge:', error);
    }
  }

  async hideBadge(): Promise<void> {
    if (!this.isNativePlatform) return;
    
    try {
      await IvsVideoPlayer.hideBadge();
    } catch (error) {
      console.error('[IvsVideoPlayer] Failed to hide badge:', error);
    }
  }
}
