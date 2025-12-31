import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import {
  IonContent,
  IonItem,
  IonInput,
  IonButton,
  IonSpinner,
  IonIcon,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { lockClosedOutline, arrowBackOutline, checkmarkCircleOutline, alertCircleOutline, shieldCheckmarkOutline } from 'ionicons/icons';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { FooterComponent } from '../shared/footer/footer.component';

@Component({
  selector: 'app-reset-password',
  templateUrl: './reset-password.page.html',
  styleUrls: ['./reset-password.page.scss'],
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
export class ResetPasswordPage implements OnInit {
  token = '';
  newPassword = '';
  confirmPassword = '';
  isLoading = false;
  isVerifying = true;
  errorMessage = '';
  successMessage = '';
  tokenError = '';

  constructor(
    private http: HttpClient,
    private route: ActivatedRoute,
    private router: Router
  ) {
    addIcons({ lockClosedOutline, arrowBackOutline, checkmarkCircleOutline, alertCircleOutline, shieldCheckmarkOutline });
  }

  async ngOnInit() {
    this.token = this.route.snapshot.queryParamMap.get('token') || '';
    
    if (!this.token) {
      this.tokenError = 'Invalid reset link. Please request a new password reset.';
      this.isVerifying = false;
      return;
    }

    await this.verifyToken();
  }

  async verifyToken() {
    try {
      const response = await firstValueFrom(
        this.http.get<{ valid: boolean; error?: string }>(`${environment.apiBaseUrl}/auth/verify-reset-token?token=${this.token}`)
      );
      
      if (!response.valid) {
        this.tokenError = response.error || 'Invalid or expired reset link. Please request a new password reset.';
      }
    } catch (e: any) {
      this.tokenError = 'Failed to verify reset link. Please try again.';
    } finally {
      this.isVerifying = false;
    }
  }

  async onSubmit() {
    this.errorMessage = '';
    this.successMessage = '';

    if (this.newPassword.length < 6) {
      this.errorMessage = 'Password must be at least 6 characters';
      return;
    }

    if (this.newPassword !== this.confirmPassword) {
      this.errorMessage = 'Passwords do not match';
      return;
    }

    this.isLoading = true;
    try {
      const response = await firstValueFrom(
        this.http.post<{ message: string }>(`${environment.apiBaseUrl}/auth/reset-password`, {
          token: this.token,
          newPassword: this.newPassword,
        })
      );
      this.successMessage = response.message || 'Password has been reset successfully.';
    } catch (e: any) {
      this.errorMessage = e?.error?.error || 'Failed to reset password. Please try again.';
    } finally {
      this.isLoading = false;
    }
  }

  goToLogin() {
    this.router.navigate(['/login']);
  }
}
