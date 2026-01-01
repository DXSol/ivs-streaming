import { Component, OnInit } from '@angular/core';
import { CommonModule, NgFor, NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonBackButton,
  IonButtons,
  IonCheckbox,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonSearchbar,
  IonTitle,
  IonToolbar,
  IonIcon,
  IonButton,
  IonModal,
  IonInput,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { chevronDownOutline, chevronUpOutline, createOutline, trashOutline, closeOutline } from 'ionicons/icons';
import { AlertController } from '@ionic/angular/standalone';

import { AdminApiService, AdminSubscriptionRow } from '../services/admin-api.service';
import { FooterComponent } from '../shared/footer/footer.component';

interface UserGroup {
  user_id: string;
  user_email: string;
  user_name: string | null;
  user_mobile: string | null;
  user_country: string | null;
  total_paid_cents: number;
  season_ticket_status: 'pending' | 'paid' | null;
  season_ticket_purchased_at: string | null;
  items: AdminSubscriptionRow[];
}

@Component({
  selector: 'app-admin-mark-paid',
  templateUrl: './admin-mark-paid.page.html',
  styleUrls: ['./admin-mark-paid.page.scss'],
  imports: [
    CommonModule,
    FormsModule,
    NgIf,
    NgFor,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonContent,
    IonSearchbar,
    IonList,
    IonItem,
    IonLabel,
    IonCheckbox,
    IonIcon,
    IonButton,
    IonModal,
    IonInput,
    FooterComponent,
  ],
})
export class AdminMarkPaidPage implements OnInit {
  isLoading = true;
  errorMessage = '';

  search = '';

  rows: AdminSubscriptionRow[] = [];
  expandedUsers: Set<string> = new Set();
  
  // Cached grouped data to prevent infinite change detection loops
  groupedByUser: UserGroup[] = [];
  private lastSearch = '';

  // Edit user modal
  isEditModalOpen = false;
  editingUser: UserGroup | null = null;
  editName = '';
  editEmail = '';
  editMobile = '';
  editCountry = '';
  isSavingUser = false;

  constructor(
    private adminApi: AdminApiService,
    private alertController: AlertController
  ) {
    addIcons({ chevronDownOutline, chevronUpOutline, createOutline, trashOutline, closeOutline });
  }

  async ngOnInit() {
    await this.load();
  }

  async load() {
    this.isLoading = true;
    this.errorMessage = '';
    try {
      this.rows = await this.adminApi.listSubscriptions();
      this.updateGroupedData();
    } catch (e: any) {
      this.errorMessage = e?.error?.error || e?.message || 'Failed to load subscriptions';
    } finally {
      this.isLoading = false;
    }
  }

  onSearchChange() {
    this.updateGroupedData();
  }

  private updateGroupedData() {
    const q = this.search.trim().toLowerCase();
    
    // Filter rows
    const filteredRows = q 
      ? this.rows.filter(r => 
          r.user_email.toLowerCase().includes(q) ||
          r.event_title.toLowerCase().includes(q)
        )
      : this.rows;

    // Group by user
    const map = new Map<string, UserGroup>();

    for (const row of filteredRows) {
      const key = row.user_id;
      let group = map.get(key);
      if (!group) {
        group = {
          user_id: row.user_id,
          user_email: row.user_email,
          user_name: row.user_name,
          user_mobile: row.user_mobile,
          user_country: row.user_country,
          total_paid_cents: row.total_paid_cents,
          season_ticket_status: row.season_ticket_status,
          season_ticket_purchased_at: row.season_ticket_purchased_at,
          items: []
        };
        map.set(key, group);
      }
      group.items.push(row);
    }

    this.groupedByUser = Array.from(map.values()).sort((a, b) => (a.user_email || '').localeCompare(b.user_email || ''));
  }

  toggleExpand(userId: string) {
    if (this.expandedUsers.has(userId)) {
      this.expandedUsers.delete(userId);
    } else {
      this.expandedUsers.add(userId);
    }
  }

  isExpanded(userId: string): boolean {
    return this.expandedUsers.has(userId);
  }

  async togglePaid(row: AdminSubscriptionRow, paid: boolean) {
    try {
      await this.adminApi.setTicketPaid({
        userId: row.user_id,
        eventId: row.event_id,
        paid,
      });

      row.ticket_status = paid ? 'paid' : 'pending';
    } catch (e: any) {
      this.errorMessage = e?.error?.error || e?.message || 'Failed to update ticket';
    }
  }

  async toggleSeasonTicket(user: UserGroup, paid: boolean) {
    try {
      await this.adminApi.setSeasonTicketStatus(user.user_id, paid);
      user.season_ticket_status = paid ? 'paid' : null;
      user.season_ticket_purchased_at = paid ? new Date().toISOString() : null;
    } catch (e: any) {
      this.errorMessage = e?.error?.error || e?.message || 'Failed to update season ticket';
    }
  }

  openEditModal(user: UserGroup, event: Event) {
    event.stopPropagation();
    this.editingUser = user;
    this.editName = user.user_name || '';
    this.editEmail = user.user_email || '';
    this.editMobile = user.user_mobile || '';
    this.editCountry = user.user_country || '';
    this.isEditModalOpen = true;
  }

  closeEditModal() {
    this.isEditModalOpen = false;
    this.editingUser = null;
  }

  async saveUser() {
    if (!this.editingUser) return;

    this.isSavingUser = true;
    try {
      await this.adminApi.updateUser(this.editingUser.user_id, {
        name: this.editName.trim() || undefined,
        email: this.editEmail.trim() || undefined,
        mobile: this.editMobile.trim() || undefined,
        country: this.editCountry.trim() || undefined,
      });

      // Update local data
      this.editingUser.user_name = this.editName.trim() || null;
      this.editingUser.user_email = this.editEmail.trim();
      this.editingUser.user_mobile = this.editMobile.trim() || null;
      this.editingUser.user_country = this.editCountry.trim() || null;

      this.closeEditModal();
    } catch (e: any) {
      this.errorMessage = e?.error?.error || e?.message || 'Failed to update user';
    } finally {
      this.isSavingUser = false;
    }
  }

  async confirmDeleteUser(user: UserGroup, event: Event) {
    event.stopPropagation();

    const alert = await this.alertController.create({
      header: 'Delete User',
      message: `Are you sure you want to delete ${user.user_name || user.user_email}? This will remove all their subscriptions and payment history.`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: () => this.deleteUser(user),
        },
      ],
    });

    await alert.present();
  }

  async deleteUser(user: UserGroup) {
    try {
      await this.adminApi.deleteUser(user.user_id);
      this.groupedByUser = this.groupedByUser.filter(g => g.user_id !== user.user_id);
    } catch (e: any) {
      this.errorMessage = e?.error?.error || e?.message || 'Failed to delete user';
    }
  }

  async confirmDeleteSubscription(row: AdminSubscriptionRow, event: Event) {
    event.stopPropagation();

    const alert = await this.alertController.create({
      header: 'Delete Subscription',
      message: `Are you sure you want to delete the subscription for "${row.event_title}"?`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: () => this.deleteSubscription(row),
        },
      ],
    });

    await alert.present();
  }

  async deleteSubscription(row: AdminSubscriptionRow) {
    try {
      await this.adminApi.deleteSubscription(row.user_id, row.event_id);
      // Remove from local data
      for (const group of this.groupedByUser) {
        group.items = group.items.filter(item => !(item.user_id === row.user_id && item.event_id === row.event_id));
      }
      // Remove empty groups
      this.groupedByUser = this.groupedByUser.filter(g => g.items.length > 0);
    } catch (e: any) {
      this.errorMessage = e?.error?.error || e?.message || 'Failed to delete subscription';
    }
  }
}
