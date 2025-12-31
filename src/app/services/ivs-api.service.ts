import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

export interface PlaybackTokenResponse {
  token: string;
  expiresAt: string;
}

@Injectable({
  providedIn: 'root',
})
export class IvsApiService {
  constructor(private http: HttpClient) {}

  async getPlaybackToken(eventId: string): Promise<PlaybackTokenResponse> {
    const url = `${environment.apiBaseUrl}/ivs/playback-token?eventId=${encodeURIComponent(eventId)}`;
    return await firstValueFrom(this.http.get<PlaybackTokenResponse>(url));
  }
}
