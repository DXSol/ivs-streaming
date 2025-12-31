import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  IonContent,
  IonItem,
  IonInput,
  IonButton,
  IonSpinner,
  IonIcon,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { mailOutline, arrowBackOutline, checkmarkCircleOutline, alertCircleOutline } from 'ionicons/icons';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { FooterComponent } from '../shared/footer/footer.component';

@Component({
  selector: 'app-forgot-password',
  templateUrl: './forgot-password.page.html',
  styleUrls: ['./forgot-password.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    IonContent,
    IonItem,
    IonInput,
    IonButton,
    IonSpinner,
    IonIcon,
    FooterComponent,
  ],
})
export class ForgotPasswordPage {
  email = '';
  isLoading = false;
  errorMessage = '';
  successMessage = '';

  constructor(private http: HttpClient) {
    addIcons({ mailOutline, arrowBackOutline, checkmarkCircleOutline, alertCircleOutline });
  }

  async onSubmit() {
    this.errorMessage = '';
    this.successMessage = '';

    const email = this.email.trim();
    if (!email) {
      this.errorMessage = 'Please enter your email address';
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      this.errorMessage = 'Please enter a valid email address';
      return;
    }

    this.isLoading = true;
    try {
      const response = await firstValueFrom(
        this.http.post<{ message: string }>(`${environment.apiBaseUrl}/auth/forgot-password`, { email })
      );
      this.successMessage = response.message || 'If an account with that email exists, a password reset link has been sent.';
      this.email = '';
    } catch (e: any) {
      this.errorMessage = e?.error?.error || 'Failed to send reset email. Please try again.';
    } finally {
      this.isLoading = false;
    }
  }
}
