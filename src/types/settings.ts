export interface NotificationSettings {
  taskReminders: boolean;
}

export interface UserSettings {
  theme: 'light' | 'dark';
  notifications?: NotificationSettings;
}
