import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import {
  IonButton,
  IonIcon,
  ModalController,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { closeOutline, documentTextOutline, checkmarkCircleOutline } from 'ionicons/icons';

@Component({
  selector: 'app-refund-policy-modal',
  standalone: true,
  imports: [CommonModule, IonButton, IonIcon],
  templateUrl: './refund-policy-modal.component.html',
  styleUrls: ['./refund-policy-modal.component.scss'],
})
export class RefundPolicyModalComponent {
  constructor(
    private modalController: ModalController,
    private router: Router
  ) {
    addIcons({ closeOutline, documentTextOutline, checkmarkCircleOutline });
  }

  dismiss(accepted: boolean = false) {
    this.modalController.dismiss({ accepted });
  }

  async openFullTerms() {
    await this.modalController.dismiss({ accepted: false });
    this.router.navigate(['/terms']);
  }
}
