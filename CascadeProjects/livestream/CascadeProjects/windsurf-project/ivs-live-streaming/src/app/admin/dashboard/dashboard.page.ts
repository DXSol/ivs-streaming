import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import {
  IonContent, IonHeader, IonTitle, IonToolbar, IonButtons, IonBackButton,
  IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonBadge, IonSpinner,
  IonButton, IonRefresher, IonRefresherContent
} from '@ionic/angular/standalone';
import { environment } from '../../../environments/environment';
import { FooterComponent } from '../../shared/footer/footer.component';

interface DashboardEvent {
  id: string;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string;
  poster_url: string | null;
  paid_tickets: number;
  pending_tickets: number;
  total_comments: number;
  peak_viewers: number | null;
  last_viewer_count: number | null;
  is_live: boolean;
  current_viewers: number;
}

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.page.html',
  styleUrls: ['./dashboard.page.scss'],
  standalone: true,
  imports: [
    IonContent, IonHeader, IonTitle, IonToolbar, IonButtons, IonBackButton,
    IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonBadge, IonSpinner,
    IonButton, IonRefresher, IonRefresherContent,
    CommonModule, FormsModule, DatePipe, RouterLink,
    FooterComponent
  ]
})
export class DashboardPage implements OnInit, OnDestroy {
  events: DashboardEvent[] = [];
  isLoading = true;
  errorMessage = '';
  private refreshInterval?: any;

  constructor(private http: HttpClient) {}

  ngOnInit() {
    this.loadDashboard();
    // Auto-refresh every 30 seconds
    this.refreshInterval = setInterval(() => this.loadDashboard(true), 30000);
  }

  ngOnDestroy() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
  }

  async loadDashboard(silent = false) {
    if (!silent) {
      this.isLoading = true;
    }
    this.errorMessage = '';

    try {
      const url = `${environment.apiBaseUrl}/admin/events/dashboard`;
      const resp = await firstValueFrom(this.http.get<{ events: DashboardEvent[] }>(url));
      this.events = resp.events;
    } catch (err: any) {
      this.errorMessage = err?.error?.error || 'Failed to load dashboard';
    } finally {
      this.isLoading = false;
    }
  }

  async handleRefresh(event: any) {
    await this.loadDashboard(true);
    event.target.complete();
  }

  getEventStatus(event: DashboardEvent): string {
    const now = new Date();
    const start = new Date(event.starts_at);
    const end = new Date(event.ends_at);

    if (event.is_live) return 'live';
    if (now < start) return 'upcoming';
    if (now > end) return 'ended';
    return 'scheduled';
  }

  getStatusColor(status: string): string {
    switch (status) {
      case 'live': return 'danger';
      case 'upcoming': return 'primary';
      case 'ended': return 'medium';
      default: return 'warning';
    }
  }
}

