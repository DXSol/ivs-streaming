import { Injectable } from '@angular/core';

declare global {
  interface Window {
    IVSPlayer?: any;
  }
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

  async createAndAttachPlayer(videoEl: HTMLVideoElement, playbackUrl: string) {
    await this.loadSdk();

    const IVSPlayer = window.IVSPlayer;
    
    if (!IVSPlayer?.isPlayerSupported) {
      throw new Error('IVS Player is not supported in this browser');
    }

    if (!IVSPlayer.isPlayerSupported) {
      throw new Error('IVS Player is not supported in this browser');
    }

    const player = IVSPlayer.create();
    
    player.attachHTMLVideoElement(videoEl);
    
    player.load(playbackUrl);
    
    return player;
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
