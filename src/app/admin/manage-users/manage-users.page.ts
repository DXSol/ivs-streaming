import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonContent, IonHeader, IonTitle, IonToolbar, IonButtons, IonMenuButton,
  IonList, IonItem, IonLabel, IonButton, IonIcon, IonSelect, IonSelectOption,
  IonInput, IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonGrid,
  IonRow, IonCol, IonSpinner, IonBadge, AlertController, ToastController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { addOutline, trashOutline, createOutline, closeCircleOutline, checkmarkCircleOutline } from 'ionicons/icons';
import { AdminApiService, AdminUser } from '../../services/admin-api.service';

@Component({
  selector: 'app-manage-users',
  templateUrl: './manage-users.page.html',
  styleUrls: ['./manage-users.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonContent, IonHeader, IonTitle, IonToolbar, IonButtons, IonMenuButton,
    IonList, IonItem, IonLabel, IonButton, IonIcon, IonSelect, IonSelectOption,
    IonInput, IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonGrid,
    IonRow, IonCol, IonSpinner, IonBadge
  ]
})
export class ManageUsersPage implements OnInit {
  users: AdminUser[] = [];
  loading = false;
  showAddForm = false;

  newUser = {
    name: '',
    email: '',
    mobile: '',
    password: '',
    confirmPassword: '',
    role: 'admin' as 'admin' | 'finance-admin' | 'content-admin'
  };

  editingUser: { id: string; name: string; email: string; mobile: string; role: string } | null = null;

  constructor(
    private adminApi: AdminApiService,
    private alertController: AlertController,
    private toastController: ToastController
  ) {
    addIcons({ addOutline, trashOutline, createOutline, closeCircleOutline, checkmarkCircleOutline });
  }

  async ngOnInit() {
    await this.loadUsers();
  }

  async loadUsers() {
    this.loading = true;
    try {
      this.users = await this.adminApi.listAdminUsers();
    } catch (error) {
      console.error('Failed to load users:', error);
      await this.showToast('Failed to load users', 'danger');
    } finally {
      this.loading = false;
    }
  }

  async createUser() {
    if (!this.newUser.name || !this.newUser.email || !this.newUser.mobile || !this.newUser.password || !this.newUser.confirmPassword) {
      await this.showToast('Please fill all required fields', 'warning');
      return;
    }

    if (this.newUser.password !== this.newUser.confirmPassword) {
      await this.showToast('Passwords do not match', 'warning');
      return;
    }

    if (this.newUser.password.length < 6) {
      await this.showToast('Password must be at least 6 characters', 'warning');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(this.newUser.email)) {
      await this.showToast('Please enter a valid email', 'warning');
      return;
    }

    this.loading = true;
    try {
      await this.adminApi.createAdminUser(
        this.newUser.name,
        this.newUser.email,
        this.newUser.mobile,
        this.newUser.password,
        this.newUser.role
      );
      await this.showToast('User created successfully', 'success');
      this.showAddForm = false;
      this.resetForm();
      await this.loadUsers();
    } catch (error: any) {
      console.error('Failed to create user:', error);
      await this.showToast(error?.error?.error || 'Failed to create user', 'danger');
    } finally {
      this.loading = false;
    }
  }

  async updateUserRole(userId: string, newRole: 'admin' | 'finance-admin' | 'content-admin') {
    const alert = await this.alertController.create({
      header: 'Confirm Role Change',
      message: 'Are you sure you want to change this user\'s role?',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Confirm',
          handler: async () => {
            this.loading = true;
            try {
              await this.adminApi.updateUserRole(userId, newRole);
              await this.showToast('Role updated successfully', 'success');
              await this.loadUsers();
            } catch (error) {
              console.error('Failed to update role:', error);
              await this.showToast('Failed to update role', 'danger');
            } finally {
              this.loading = false;
            }
          }
        }
      ]
    });
    await alert.present();
  }

  async deleteUser(userId: string, userName: string) {
    const alert = await this.alertController.create({
      header: 'Confirm Delete',
      message: `Are you sure you want to delete ${userName}?`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: async () => {
            this.loading = true;
            try {
              await this.adminApi.deleteAdminUser(userId);
              await this.showToast('User deleted successfully', 'success');
              await this.loadUsers();
            } catch (error) {
              console.error('Failed to delete user:', error);
              await this.showToast('Failed to delete user', 'danger');
            } finally {
              this.loading = false;
            }
          }
        }
      ]
    });
    await alert.present();
  }

  resetForm() {
    this.newUser = {
      name: '',
      email: '',
      mobile: '',
      password: '',
      confirmPassword: '',
      role: 'admin'
    };
  }

  startEditUser(user: AdminUser) {
    this.editingUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      mobile: (user as any).mobile || '',
      role: user.role
    };
  }

  cancelEdit() {
    this.editingUser = null;
  }

  async saveUserEdit() {
    if (!this.editingUser) return;

    if (!this.editingUser.name || !this.editingUser.email || !this.editingUser.mobile) {
      await this.showToast('Please fill all required fields', 'warning');
      return;
    }

    this.loading = true;
    try {
      await this.adminApi.updateAdminUser(this.editingUser.id, {
        name: this.editingUser.name,
        email: this.editingUser.email,
        mobile: this.editingUser.mobile
      });
      await this.showToast('User updated successfully', 'success');
      this.editingUser = null;
      await this.loadUsers();
    } catch (error: any) {
      console.error('Failed to update user:', error);
      await this.showToast(error?.error?.error || 'Failed to update user', 'danger');
    } finally {
      this.loading = false;
    }
  }

  async toggleUserStatus(userId: string, currentStatus: boolean) {
    const alert = await this.alertController.create({
      header: 'Confirm',
      message: `Are you sure you want to ${currentStatus ? 'disable' : 'enable'} this user?`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Confirm',
          handler: async () => {
            this.loading = true;
            try {
              await this.adminApi.toggleAdminUserStatus(userId, !currentStatus);
              await this.showToast(`User ${!currentStatus ? 'enabled' : 'disabled'} successfully`, 'success');
              await this.loadUsers();
            } catch (error) {
              console.error('Failed to toggle user status:', error);
              await this.showToast('Failed to update user status', 'danger');
            } finally {
              this.loading = false;
            }
          }
        }
      ]
    });
    await alert.present();
  }

  async showToast(message: string, color: string) {
    const toast = await this.toastController.create({
      message,
      duration: 3000,
      color,
      position: 'top'
    });
    await toast.present();
  }

  getRoleName(role: string): string {
    const roleMap: Record<string, string> = {
      'admin': 'Admin',
      'superadmin': 'Super Admin',
      'finance-admin': 'Finance Admin',
      'content-admin': 'Content Admin'
    };
    return roleMap[role] || role;
  }
}
