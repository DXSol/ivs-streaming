import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

export interface RecordingSession {
  index: number;
  sessionId: string;
  timestamp: string;
  dateTime: string;
  playbackUrl: string;
  expiresAt: string;
}

export interface RecordingPlaybackResponse {
  playbackUrl: string;
  expiresAt: string;
  recordingExpiresAt: string;
  eventTitle: string;
  sessions?: RecordingSession[];
  totalSessions?: number;
}

export interface RecordingStatusResponse {
  available: boolean;
  reason: string;
  expiresAt?: string;
  expiredAt?: string;
  availableAfter?: string;
}

@Injectable({
  providedIn: 'root',
})
export class RecordingsApiService {
  private baseUrl = environment.apiBaseUrl;

  constructor(private http: HttpClient) {}

  /**
   * Get a signed playback URL for a recorded event.
   * URL is valid for ~30 minutes.
   */
  async getPlaybackUrl(eventId: string): Promise<RecordingPlaybackResponse> {
    return firstValueFrom(
      this.http.get<RecordingPlaybackResponse>(
        `${this.baseUrl}/recordings/${eventId}/playback-url`
      )
    );
  }

  /**
   * Check if a recording is available for an event.
   */
  async getRecordingStatus(eventId: string): Promise<RecordingStatusResponse> {
    return firstValueFrom(
      this.http.get<RecordingStatusResponse>(
        `${this.baseUrl}/recordings/${eventId}/status`
      )
    );
  }

  /**
   * Check if a signed URL is about to expire (within 5 minutes).
   */
  isUrlExpiringSoon(expiresAt: string): boolean {
    const expiryTime = new Date(expiresAt).getTime();
    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;
    return expiryTime - now < fiveMinutes;
  }

  /**
   * Calculate remaining time until URL expires.
   */
  getTimeUntilExpiry(expiresAt: string): number {
    return new Date(expiresAt).getTime() - Date.now();
  }
}
