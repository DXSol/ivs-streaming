import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

export interface PlaybackResponse {
  streamId: string;
  playbackUrl: string;
}

@Injectable({
  providedIn: 'root',
})
export class StreamsApiService {
  constructor(private http: HttpClient) {}

  async getPlayback(streamId: string): Promise<PlaybackResponse> {
    const base = environment.apiBaseUrl;
    if (!base) {
      throw new Error('environment.apiBaseUrl is not configured');
    }

    const url = `${base}/streams/${encodeURIComponent(streamId)}/playback`;
    return await firstValueFrom(this.http.get<PlaybackResponse>(url));
  }
}
