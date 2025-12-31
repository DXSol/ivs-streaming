import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import {
  IonContent, IonHeader, IonTitle, IonToolbar, IonButtons, IonBackButton,
  IonItem, IonLabel, IonInput, IonTextarea, IonButton, IonDatetime,
  IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonSpinner, IonProgressBar,
  IonSegment, IonSegmentButton, IonToggle
} from '@ionic/angular/standalone';
import { FooterComponent } from '../../shared/footer/footer.component';
import { EventsApiService, CreateEventDto } from '../../services/events-api.service';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-edit-event',
  templateUrl: './edit-event.page.html',
  styleUrls: ['./edit-event.page.scss'],
  standalone: true,
  imports: [
    IonContent, IonHeader, IonTitle, IonToolbar, IonButtons, IonBackButton,
    IonItem, IonLabel, IonInput, IonTextarea, IonButton, IonDatetime,
    IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonSpinner, IonProgressBar,
    IonSegment, IonSegmentButton, IonToggle,
    CommonModule, FormsModule,
    FooterComponent
  ]
})
export class EditEventPage implements OnInit {
  eventId = '';
  title = '';
  description = '';
  eventType: 'paid' | 'free' | 'free-short' = 'paid';
  ivsChannelArn = '';
  youtubeUrl = '';
  startsAt = '';
  endsAt = '';
  posterUrl = '';
  posterPreview = '';
  priceRupees = 500;
  recordingOnly = false;
  recordingAvailableHours = 0;

  isLoading = true;
  isSubmitting = false;
  isUploading = false;
  errorMessage = '';
  successMessage = '';

  constructor(
    private eventsApi: EventsApiService,
    private router: Router,
    private route: ActivatedRoute,
    private http: HttpClient
  ) {}

  async ngOnInit() {
    this.eventId = this.route.snapshot.paramMap.get('id') || '';
    if (!this.eventId) {
      this.errorMessage = 'Event ID is required';
      this.isLoading = false;
      return;
    }

    await this.loadEvent();
  }

  private async loadEvent() {
    try {
      const event = await this.eventsApi.getEvent(this.eventId);
      this.title = event.title;
      this.description = event.description || '';
      this.eventType = (event as any).event_type || 'paid';
      this.ivsChannelArn = (event as any).ivs_channel_arn || '';
      this.youtubeUrl = (event as any).youtube_url || '';
      this.startsAt = this.formatDateForInput(event.starts_at);
      this.endsAt = this.formatDateForInput(event.ends_at);
      this.posterUrl = event.poster_url || '';
      this.posterPreview = event.poster_url || '';
      this.priceRupees = (event.price_paise || 50000) / 100;
      this.recordingOnly = event.recording_only || false;
      this.recordingAvailableHours = event.recording_available_hours || 0;
    } catch (err: any) {
      this.errorMessage = err?.error?.error || err?.message || 'Failed to load event';
    } finally {
      this.isLoading = false;
    }
  }

  private formatDateForInput(dateStr: string): string {
    // Parse the ISO date string and format for datetime-local input
    // This preserves the original time without timezone conversion
    const date = new Date(dateStr);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }

  async onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];

    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      this.errorMessage = 'Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.';
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      this.errorMessage = 'File too large. Maximum size is 5MB.';
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      this.posterPreview = e.target?.result as string;
    };
    reader.readAsDataURL(file);

    this.isUploading = true;
    this.errorMessage = '';

    try {
      const formData = new FormData();
      formData.append('poster', file);

      const url = `${environment.apiBaseUrl}/uploads/poster`;
      const resp = await firstValueFrom(
        this.http.post<{ url: string; filename: string }>(url, formData)
      );

      this.posterUrl = `${environment.apiBaseUrl.replace('/api', '')}${resp.url}`;
    } catch (err: any) {
      this.errorMessage = err?.error?.error || 'Failed to upload image';
      this.posterPreview = this.posterUrl;
    } finally {
      this.isUploading = false;
    }
  }

  removePoster() {
    this.posterUrl = '';
    this.posterPreview = '';
  }

  async submitEvent() {
    this.errorMessage = '';
    this.successMessage = '';

    if (!this.title.trim()) {
      this.errorMessage = 'Event name is required';
      return;
    }
    if (this.eventType === 'paid' && !this.ivsChannelArn.trim()) {
      this.errorMessage = 'IVS Channel ARN is required for paid events';
      return;
    }
    if (this.eventType === 'free' && !this.youtubeUrl.trim()) {
      this.errorMessage = 'YouTube URL is required for free events';
      return;
    }
    if (!this.startsAt || !this.endsAt) {
      this.errorMessage = 'Start and end dates are required';
      return;
    }

    const startDate = new Date(this.startsAt);
    const endDate = new Date(this.endsAt);
    if (endDate <= startDate) {
      this.errorMessage = 'End date must be after start date';
      return;
    }

    this.isSubmitting = true;

    try {
      const eventData: Partial<CreateEventDto> = {
        title: this.title.trim(),
        description: this.description.trim() || undefined,
        event_type: this.eventType,
        ivs_channel_arn: this.eventType === 'paid' ? this.ivsChannelArn.trim() : undefined,
        youtube_url: (this.eventType === 'free' || this.eventType === 'free-short') ? this.youtubeUrl.trim() : undefined,
        starts_at: new Date(this.startsAt).toISOString(),
        ends_at: new Date(this.endsAt).toISOString(),
        poster_url: this.posterUrl.trim() || undefined,
        price_paise: this.eventType === 'paid' ? Math.round(this.priceRupees * 100) : 0,
        recording_only: this.eventType === 'paid' ? this.recordingOnly : false,
        recording_available_hours: (this.eventType === 'paid' && this.recordingOnly) ? this.recordingAvailableHours : 0,
      };

      const updated = await this.eventsApi.updateEvent(this.eventId, eventData);
      this.successMessage = `Event "${updated.title}" updated successfully!`;

      setTimeout(() => {
        this.router.navigate(['/events']);
      }, 1500);
    } catch (err: any) {
      this.errorMessage = err?.error?.error || err?.message || 'Failed to update event';
    } finally {
      this.isSubmitting = false;
    }
  }
}
