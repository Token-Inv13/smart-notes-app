import { collection, doc, setDoc, getDoc, updateDoc } from 'firebase/firestore';
import { db, getFCMToken } from './firebase';
import { UserSettings } from '../types/settings';

export class NotificationService {
  private static async saveTokenToDatabase(userId: string, token: string) {
    const userRef = doc(db, 'users', userId);
    await updateDoc(userRef, {
      fcmTokens: { [token]: true }
    });
  }

  public static async initialize(userId: string) {
    const token = await getFCMToken();
    if (token) {
      await this.saveTokenToDatabase(userId, token);
    }
  }

  public static async updateNotificationSettings(userId: string, enabled: boolean) {
    const userRef = doc(db, 'users', userId);
    const userDoc = await getDoc(userRef);
    
    if (!userDoc.exists()) {
      throw new Error('User document not found');
    }

    const settings: UserSettings = userDoc.data() as UserSettings;
    settings.notifications = {
      ...settings.notifications,
      taskReminders: enabled
    };

    await updateDoc(userRef, { settings });
  }

  public static async scheduleTaskReminder(userId: string, taskId: string, dueDate: Date) {
    const userRef = doc(db, 'users', userId);
    const userDoc = await getDoc(userRef);
    
    if (!userDoc.exists()) return;
    
    const settings: UserSettings = userDoc.data() as UserSettings;
    if (!settings.notifications?.taskReminders) return;

    // Reminder is triggered at the explicit time chosen by the user (no offset logic).
    const reminderTime = dueDate;

    // Store the reminder in Firestore
    const remindersRef = collection(db, 'taskReminders');
    await setDoc(doc(remindersRef), {
      userId,
      taskId,
      dueDate: reminderTime.toISOString(),
      reminderTime: reminderTime.toISOString(),
      sent: false
    });
  }
}
