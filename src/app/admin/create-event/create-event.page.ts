import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import {
  IonContent, IonHeader, IonTitle, IonToolbar, IonButtons, IonBackButton,
  IonItem, IonLabel, IonInput, IonTextarea, IonButton, IonDatetime,
  IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonSpinner, IonProgressBar,
  IonSegment, IonSegmentButton, IonToggle
} from '@ionic/angular/standalone';
import { EventsApiService, CreateEventDto } from '../../services/events-api.service';
import { environment } from '../../../environments/environment';
import { FooterComponent } from '../../shared/footer/footer.component';

@Component({
  selector: 'app-create-event',
  templateUrl: './create-event.page.html',
  styleUrls: ['./create-event.page.scss'],
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
export class CreateEventPage implements OnInit {
  title = '';
  description = '';
  eventType: 'paid' | 'free' | 'free-short' = 'paid';
  ivsChannelArn = '';
  youtubeUrl = '';
  startsAt = '';
  endsAt = '';
  posterUrl = '';
  posterPreview = '';
  priceRupees = 500; // Default price in rupees
  recordingOnly = false; // Deferred Live - recording only, no live stream
  recordingAvailableHours = 0; // Hours after event ends when recording becomes available

  isSubmitting = false;
  isUploading = false;
  errorMessage = '';
  successMessage = '';

  constructor(
    private eventsApi: EventsApiService,
    private router: Router,
    private http: HttpClient
  ) {}

  ngOnInit() {
    // Set default dates to now and 2 hours from now
    const now = new Date();
    const twoHoursLater = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    this.startsAt = this.formatDateForInput(now);
    this.endsAt = this.formatDateForInput(twoHoursLater);
  }

  private formatDateForInput(date: Date): string {
    // Use local date components to avoid timezone conversion
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

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      this.errorMessage = 'Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.';
      return;
    }

    // Validate file size (5MB max)
    if (file.size > 8 * 1024 * 1024) {
      this.errorMessage = 'File too large. Maximum size is 5MB.';
      return;
    }

    // Show preview
    const reader = new FileReader();
    reader.onload = (e) => {
      this.posterPreview = e.target?.result as string;
    };
    reader.readAsDataURL(file);

    // Upload file
    this.isUploading = true;
    this.errorMessage = '';

    try {
      const formData = new FormData();
      formData.append('poster', file);

      const url = `${environment.apiBaseUrl}/uploads/poster`;
      const resp = await firstValueFrom(
        this.http.post<{ url: string; filename: string }>(url, formData)
      );

      // Construct full URL for the poster
      this.posterUrl = `${environment.apiBaseUrl.replace('/api', '')}${resp.url}`;
    } catch (err: any) {
      this.errorMessage = err?.error?.error || 'Failed to upload image';
      this.posterPreview = '';
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
      const eventData: CreateEventDto = {
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

      const created = await this.eventsApi.createEvent(eventData);
      this.successMessage = `Event "${created.title}" created successfully!`;

      // Reset form
      this.title = '';
      this.description = '';
      this.eventType = 'paid';
      this.ivsChannelArn = '';
      this.youtubeUrl = '';
      this.posterUrl = '';
      this.recordingOnly = false;
      this.recordingAvailableHours = 0;

      // Navigate to events list after a short delay
      setTimeout(() => {
        this.router.navigate(['/events']);
      }, 1500);
    } catch (err: any) {
      this.errorMessage = err?.error?.error || err?.message || 'Failed to create event';
    } finally {
      this.isSubmitting = false;
    }
  }
}

