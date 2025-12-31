import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

export interface SessionStartResponse {
  ok: boolean;
  resumed?: boolean;
}

export interface SessionErrorResponse {
  error: string;
  message: string;
  maxDevices: number;
  currentDevices: number;
}

export interface SessionStatusResponse {
  activeSessions: number;
  maxDevices: number;
  sessions: Array<{
    session_id: string;
    last_heartbeat: string;
    created_at: string;
  }>;
}

@Injectable({
  providedIn: 'root',
})
export class ViewingSessionService {
  private readonly SESSION_KEY_PREFIX = 'viewing_session_';
  private heartbeatInterval: any = null;
  private currentEventId: string | null = null;
  private currentSessionId: string | null = null;
  
  // Unique tab ID generated once per tab/window
  private readonly tabId: string;

  constructor(private http: HttpClient) {
    // Generate a unique ID for this tab/window instance
    this.tabId = `${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
  }

  private generateSessionId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
  }

  private getStoredSessionId(eventId: string): string | null {
    return sessionStorage.getItem(`${this.SESSION_KEY_PREFIX}${eventId}`);
  }

  private storeSessionId(eventId: string, sessionId: string): void {
    sessionStorage.setItem(`${this.SESSION_KEY_PREFIX}${eventId}`, sessionId);
  }

  private clearStoredSessionId(eventId: string): void {
    sessionStorage.removeItem(`${this.SESSION_KEY_PREFIX}${eventId}`);
  }

  async startSession(eventId: string): Promise<{ success: boolean; error?: string; maxDevices?: number }> {
    // Use tab-specific session ID to ensure each tab/window is counted separately
    // The tabId is unique per browser tab, so each tab gets its own session
    const sessionId = `${this.tabId}-${eventId}`;

    const url = `${environment.apiBaseUrl}/viewing-sessions/start`;

    try {
      await firstValueFrom(
        this.http.post<SessionStartResponse>(url, { eventId, sessionId })
      );

      this.currentEventId = eventId;
      this.currentSessionId = sessionId;

      // Start heartbeat
      this.startHeartbeat();

      return { success: true };
    } catch (e: any) {
      if (e?.status === 429) {
        const errorData = e.error as SessionErrorResponse;
        return {
          success: false,
          error: errorData.message || 'Device limit reached',
          maxDevices: errorData.maxDevices,
        };
      }
      // Don't block playback if session tracking fails
      return { success: true };
    }
  }

  private startHeartbeat(): void {
    // Clear any existing heartbeat
    this.stopHeartbeat();

    // Send heartbeat every 30 seconds
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, 30000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private async sendHeartbeat(): Promise<void> {
    if (!this.currentEventId || !this.currentSessionId) return;

    const url = `${environment.apiBaseUrl}/viewing-sessions/heartbeat`;

    try {
      await firstValueFrom(
        this.http.post(url, {
          eventId: this.currentEventId,
          sessionId: this.currentSessionId,
        })
      );
    } catch (e: any) {
      // If session expired, stop heartbeat
      if (e?.error?.expired) {
        this.stopHeartbeat();
      }
    }
  }

  async endSession(eventId?: string): Promise<void> {
    const targetEventId = eventId || this.currentEventId;
    const sessionId = eventId ? this.getStoredSessionId(eventId) : this.currentSessionId;

    if (!targetEventId || !sessionId) return;

    this.stopHeartbeat();

    const url = `${environment.apiBaseUrl}/viewing-sessions/end`;

    try {
      await firstValueFrom(
        this.http.post(url, { eventId: targetEventId, sessionId })
      );
    } catch {
      // Silently fail - session will expire anyway
    }

    if (eventId) {
      this.clearStoredSessionId(eventId);
    } else {
      if (this.currentEventId) {
        this.clearStoredSessionId(this.currentEventId);
      }
      this.currentEventId = null;
      this.currentSessionId = null;
    }
  }

  async getSessionStatus(eventId: string): Promise<SessionStatusResponse | null> {
    const url = `${environment.apiBaseUrl}/viewing-sessions/status/${encodeURIComponent(eventId)}`;

    try {
      return await firstValueFrom(this.http.get<SessionStatusResponse>(url));
    } catch {
      return null;
    }
  }

  cleanup(): void {
    this.stopHeartbeat();
    if (this.currentEventId) {
      this.endSession();
    }
  }
}
