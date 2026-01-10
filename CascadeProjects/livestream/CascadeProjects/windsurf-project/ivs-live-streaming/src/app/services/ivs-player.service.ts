import { Injectable } from '@angular/core';

declare global {
  interface Window {
    IVSPlayer?: any;
  }
}

/**
 * Configuration options for the IVS player.
 * These can be used to tune playback behavior for debugging or optimization.
 */
export interface IvsPlayerConfig {
  /** Disable low latency mode to increase buffer size (default: false) */
  disableLowLatency?: boolean;
  /** Disable auto quality switching - locks to initial quality (default: false) */
  disableAutoQuality?: boolean;
  /** Maximum bitrate in bps for auto quality (0 = unlimited) */
  maxBitrate?: number;
  /** Initial buffer duration in seconds before playback starts */
  initialBufferDuration?: number;
  /** Enable verbose logging for debugging */
  verboseLogging?: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class IvsPlayerService {
  private scriptLoading?: Promise<void>;

  private loadSdk(): Promise<void> {

    if (this.scriptLoading) {
      return this.scriptLoading;
    }

    this.scriptLoading = new Promise((resolve, reject) => {

      if (window.IVSPlayer) {
        resolve();
        return;
      }

      const existing = document.querySelector('script[data-ivs-player-sdk="true"]') as HTMLScriptElement | null;

      if (existing) {
        existing.addEventListener('load', () => {
          resolve();
        });
        existing.addEventListener('error', () => {
          console.error('[IvsPlayerService] Existing script failed to load');
          reject(new Error('Failed to load IVS Player SDK'));
        });
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://player.live-video.net/1.31.0/amazon-ivs-player.min.js';
      script.async = true;
      script.dataset['ivsPlayerSdk'] = 'true';
      script.addEventListener('load', () => {
        resolve();
      });
      script.addEventListener('error', () => {
        reject(new Error('Failed to load IVS Player SDK'));
      });
      document.head.appendChild(script);
    });

    return this.scriptLoading;
  }

  /**
   * Create and attach an IVS player to a video element.
   * @param videoEl The HTML video element to attach the player to
   * @param playbackUrl The IVS playback URL (with or without token)
   * @param config Optional configuration for player behavior
   */
  async createAndAttachPlayer(
    videoEl: HTMLVideoElement,
    playbackUrl: string,
    config?: IvsPlayerConfig
  ) {
    await this.loadSdk();

    const IVSPlayer = window.IVSPlayer;

    if (!IVSPlayer?.isPlayerSupported) {
      throw new Error('IVS Player is not supported in this browser');
    }

    if (!IVSPlayer.isPlayerSupported) {
      throw new Error('IVS Player is not supported in this browser');
    }

    const player = IVSPlayer.create();

    // Apply configuration options if provided
    if (config) {
      this.applyPlayerConfig(player, config);
    }

    player.attachHTMLVideoElement(videoEl);

    player.load(playbackUrl);

    return player;
  }

  /**
   * Apply configuration options to the player.
   * These settings can help diagnose or mitigate playback issues.
   */
  private applyPlayerConfig(player: any, config: IvsPlayerConfig): void {
    const log = (msg: string, data?: any) => console.log(`[IvsPlayerService] ${msg}`, data || '');

    log('Applying player configuration', config);

    // Disable low latency mode to increase buffer size
    // This can help with micro-buffering issues on unstable connections
    if (config.disableLowLatency && typeof player.setLiveLowLatencyEnabled === 'function') {
      player.setLiveLowLatencyEnabled(false);
      log('Low latency mode disabled (increased buffer)');
    }

    // Disable automatic quality switching
    // This prevents ABR from causing audio glitches during quality transitions
    if (config.disableAutoQuality && typeof player.setAutoQualityMode === 'function') {
      player.setAutoQualityMode(false);
      log('Auto quality mode disabled');
    }

    // Set rebuffer to live behavior
    // Setting to false prevents automatic seeking to live edge after rebuffering
    if (typeof player.setRebufferToLive === 'function') {
      player.setRebufferToLive(false);
      log('Rebuffer to live disabled');
    }

    // Set maximum bitrate for auto quality - enforce strictly
    // This limits how high the player will go, reducing stalls on variable connections
    if (config.maxBitrate && config.maxBitrate > 0) {
      const maxBitrate = config.maxBitrate;

      // Apply immediately if method exists
      if (typeof player.setAutoMaxBitrate === 'function') {
        player.setAutoMaxBitrate(maxBitrate);
        log(`Max bitrate set to ${maxBitrate} bps (${(maxBitrate / 1000000).toFixed(1)} Mbps)`);
      }

      // Enforce on EVERY quality change - ABR may try to exceed the limit
      const PlayerEventType = window.IVSPlayer?.PlayerEventType;
      if (PlayerEventType?.QUALITY_CHANGED) {
        player.addEventListener(PlayerEventType.QUALITY_CHANGED, (quality: any) => {
          log(`Quality changed to: ${quality?.name} (${quality?.bitrate} bps)`);

          // Re-apply max bitrate on every quality change
          if (typeof player.setAutoMaxBitrate === 'function') {
            player.setAutoMaxBitrate(maxBitrate);
          }

          // If current quality exceeds max, force switch to a lower one
          if (quality?.bitrate > maxBitrate) {
            log(`Quality ${quality.name} exceeds max bitrate (${maxBitrate}), forcing lower quality`);
            const qualities = player.getQualities?.() || [];

            // Find the highest quality that's still under the limit
            const suitableQualities = qualities
              .filter((q: any) => q.bitrate <= maxBitrate)
              .sort((a: any, b: any) => b.bitrate - a.bitrate);

            if (suitableQualities.length > 0 && typeof player.setQuality === 'function') {
              const targetQuality = suitableQualities[0];
              player.setQuality(targetQuality);
              log(`Forced switch to: ${targetQuality.name} (${targetQuality.bitrate} bps)`);
            }
          }
        });
      }

      // Also enforce after manifest loads (initial quality selection)
      setTimeout(() => {
        const currentQuality = player.getQuality?.();
        if (currentQuality?.bitrate > maxBitrate) {
          log(`Initial quality ${currentQuality.name} exceeds max, switching...`);
          const qualities = player.getQualities?.() || [];
          const suitableQualities = qualities
            .filter((q: any) => q.bitrate <= maxBitrate)
            .sort((a: any, b: any) => b.bitrate - a.bitrate);

          if (suitableQualities.length > 0 && typeof player.setQuality === 'function') {
            player.setQuality(suitableQualities[0]);
            log(`Switched to: ${suitableQualities[0].name}`);
          }
        }
      }, 3000);
    }

    // Log available player methods and qualities for debugging
    log('Available player methods:', Object.keys(player).filter(k => typeof player[k] === 'function'));

    // Log available qualities after manifest loads
    setTimeout(() => {
      if (typeof player.getQualities === 'function') {
        const qualities = player.getQualities();
        log('Available qualities:', qualities);
        const currentQuality = player.getQuality?.();
        log('Current quality:', currentQuality);
      }
    }, 3000);
  }

  /**
   * Get diagnostic information about the player state.
   * Useful for debugging playback issues.
   */
  getPlayerDiagnostics(player: any): Record<string, any> {
    if (!player) return { error: 'No player instance' };

    const diagnostics: Record<string, any> = {};

    try {
      if (typeof player.getPosition === 'function') {
        diagnostics['position'] = player.getPosition();
      }
      if (typeof player.getBufferDuration === 'function') {
        diagnostics['bufferDuration'] = player.getBufferDuration();
      }
      if (typeof player.getQuality === 'function') {
        diagnostics['currentQuality'] = player.getQuality();
      }
      if (typeof player.getQualities === 'function') {
        diagnostics['availableQualities'] = player.getQualities();
      }
      if (typeof player.getState === 'function') {
        diagnostics['state'] = player.getState();
      }
      if (typeof player.getLiveLatency === 'function') {
        diagnostics['liveLatency'] = player.getLiveLatency();
      }
      if (typeof player.getVersion === 'function') {
        diagnostics['playerVersion'] = player.getVersion();
      }
    } catch (e: any) {
      diagnostics['error'] = e?.message || 'Failed to get diagnostics';
    }

    return diagnostics;
  }

  destroyPlayer(player: any) {
    if (!player) return;

    try {
      if (typeof player.pause === 'function') player.pause();
      if (typeof player.delete === 'function') player.delete();
    } catch {
      return;
    }
  }
}
