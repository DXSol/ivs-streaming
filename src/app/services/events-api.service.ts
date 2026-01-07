import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

export interface EventDto {
  id: string;
  title: string;
  description: string | null;
  event_type: 'paid' | 'free' | 'free-short';
  starts_at: string;
  ends_at: string;
  playback_url?: string | null;
  youtube_url?: string | null;
  poster_url?: string | null;
  price_paise?: number;
  recording_only?: boolean;
  recording_available_hours?: number;
  allow_past_purchase?: boolean;
}

export interface CreateEventDto {
  title: string;
  description?: string;
  event_type: 'paid' | 'free' | 'free-short';
  ivs_channel_arn?: string;
  youtube_url?: string;
  starts_at: string;
  ends_at: string;
  poster_url?: string;
  price_paise?: number;
  recording_only?: boolean;
  recording_available_hours?: number;
  allow_past_purchase?: boolean;
}

export interface EventAccessDto {
  eventId: string;
  userId: string;
  hasPaidTicket: boolean;
  hasSeasonTicket?: boolean;
  seasonTicketPurchasedAt?: string | null;
  isSubscribed: boolean;
}

export interface UserTicketStatusDto {
  tickets: Record<string, string>; // eventId -> status ('paid', 'pending', etc.)
  hasSeasonTicket: boolean;
  seasonTicketPurchasedAt: string | null;
}

export interface EventCommentDto {
  id: string;
  body: string;
  created_at: string;
  user_id: string;
  user_email: string;
  user_name?: string | null;
}

export interface RecordingExpiryInfo {
  expiresAt: string;
  isExpired: boolean;
}

export interface RecordingExpiryResponse {
  expiryInfo: Record<string, RecordingExpiryInfo>;
}

@Injectable({
  providedIn: 'root',
})
export class EventsApiService {
  constructor(private http: HttpClient) {}

  async listEvents(): Promise<EventDto[]> {
    const url = `${environment.apiBaseUrl}/events`;
    const resp = await firstValueFrom(this.http.get<{ events: EventDto[] }>(url));
    return resp.events;
  }

  async getEvent(id: string): Promise<EventDto> {
    const url = `${environment.apiBaseUrl}/events/${encodeURIComponent(id)}`;
    const resp = await firstValueFrom(this.http.get<{ event: EventDto }>(url));
    return resp.event;
  }

  async getAccess(id: string): Promise<EventAccessDto> {
    const url = `${environment.apiBaseUrl}/events/${encodeURIComponent(id)}/access`;
    return await firstValueFrom(this.http.get<EventAccessDto>(url));
  }

  async subscribe(eventId: string): Promise<void> {
    const url = `${environment.apiBaseUrl}/events/${encodeURIComponent(eventId)}/subscribe`;
    await firstValueFrom(this.http.post(url, {}));
  }

  async unsubscribe(eventId: string): Promise<void> {
    const url = `${environment.apiBaseUrl}/events/${encodeURIComponent(eventId)}/unsubscribe`;
    await firstValueFrom(this.http.post(url, {}));
  }

  async listComments(eventId: string): Promise<EventCommentDto[]> {
    const url = `${environment.apiBaseUrl}/events/${encodeURIComponent(eventId)}/comments`;
    const resp = await firstValueFrom(
      this.http.get<{ comments: EventCommentDto[] }>(url)
    );
    return resp.comments;
  }

  async addComment(eventId: string, body: string): Promise<EventCommentDto> {
    const url = `${environment.apiBaseUrl}/events/${encodeURIComponent(eventId)}/comments`;
    const resp = await firstValueFrom(
      this.http.post<{ comment: EventCommentDto }>(url, { body })
    );
    return resp.comment;
  }

  async getViewerCount(eventId: string): Promise<number> {
    const url = `${environment.apiBaseUrl}/events/${encodeURIComponent(eventId)}/viewers`;
    try {
      const resp = await firstValueFrom(this.http.get<{ count: number }>(url));
      return resp.count;
    } catch {
      return 0;
    }
  }

  async getStreamStatus(eventId: string): Promise<{ isLive: boolean; state: string; viewerCount: number }> {
    const url = `${environment.apiBaseUrl}/events/${encodeURIComponent(eventId)}/stream-status`;
    try {
      const resp = await firstValueFrom(this.http.get<{ isLive: boolean; state: string; viewerCount: number }>(url));
      return resp;
    } catch {
      return { isLive: false, state: 'ERROR', viewerCount: 0 };
    }
  }

  async createEvent(event: CreateEventDto): Promise<EventDto> {
    const url = `${environment.apiBaseUrl}/events`;
    const resp = await firstValueFrom(this.http.post<{ event: EventDto }>(url, event));
    return resp.event;
  }

  async updateEvent(id: string, event: Partial<CreateEventDto>): Promise<EventDto> {
    const url = `${environment.apiBaseUrl}/events/${encodeURIComponent(id)}`;
    const resp = await firstValueFrom(this.http.put<{ event: EventDto }>(url, event));
    return resp.event;
  }

  async getUserTicketStatus(): Promise<UserTicketStatusDto> {
    const url = `${environment.apiBaseUrl}/events/user/ticket-status`;
    return await firstValueFrom(this.http.get<UserTicketStatusDto>(url));
  }

  /**
   * Create a proxy session for Chromecast streaming
   * Returns a proxy URL that can be used by Chromecast to access the stream
   */
  async createStreamProxySession(eventId: string): Promise<{ proxyUrl: string; sessionId: string; expiresAt: string }> {
    const url = `${environment.apiBaseUrl}/stream-proxy/create-session`;
    return await firstValueFrom(this.http.post<{ proxyUrl: string; sessionId: string; expiresAt: string }>(url, { eventId }));
  }

  /**
   * Get Chromecast settings from the server
   */
  async getChromecastSettings(): Promise<{ enableLiveCasting: boolean; enableRecordingCasting: boolean }> {
    const url = `${environment.apiBaseUrl}/settings/chromecast`;
    return await firstValueFrom(this.http.get<{ enableLiveCasting: boolean; enableRecordingCasting: boolean }>(url));
  }

  /**
   * Get per-user recording expiry information
   * Returns expiry dates based on payment dates for events the user has access to
   */
  async getRecordingExpiryInfo(): Promise<RecordingExpiryResponse> {
    const url = `${environment.apiBaseUrl}/recordings/expiry-info`;
    return await firstValueFrom(this.http.get<RecordingExpiryResponse>(url));
  }
}
