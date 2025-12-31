import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonList,
  IonItem,
  IonIcon,
  IonLabel,
  IonButton,
  IonButtons,
  ModalController,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { mailOutline, callOutline, locationOutline, closeOutline, logoWhatsapp } from 'ionicons/icons';

@Component({
  selector: 'app-contact-info',
  templateUrl: './contact-info.component.html',
  styleUrls: ['./contact-info.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonList,
    IonItem,
    IonIcon,
    IonLabel,
    IonButton,
    IonButtons,
  ],
})
export class ContactInfoComponent {
  contactInfo = {
    email: 'info@sampradaya.live',
    phone: '+91 94402 58683',
    address: 'Sampradaya, Hari Vasam, Chandragiri Colony (East), Neredmet, Secunderabad, Telangana, India - 500056',
  };

  constructor(private modalController: ModalController) {
    addIcons({ mailOutline, callOutline, locationOutline, closeOutline, logoWhatsapp });
  }

  dismiss() {
    this.modalController.dismiss();
  }

  openEmail() {
    window.location.href = `mailto:${this.contactInfo.email}`;
  }

  openPhone() {
    window.location.href = `tel:${this.contactInfo.phone.replace(/\s/g, '')}`;
  }

  /*openWhatsApp() {
    const phone = this.contactInfo.whatsapp.replace(/[^0-9]/g, '');
    window.open(`https://wa.me/${phone}`, '_blank');
  }*/

  openMaps() {
    window.open(`https://maps.google.com/?q=${encodeURIComponent(this.contactInfo.address)}`, '_blank');
  }
}
