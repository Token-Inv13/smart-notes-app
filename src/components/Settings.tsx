import React, { useEffect, useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Switch,
  FormControlLabel,
  Divider
} from '@mui/material';
import { useAuth } from '../hooks/useAuth';
import { NotificationService } from '../services/notificationService';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { UserSettings } from '../types/settings';
import { NotificationTest } from './NotificationTest';

export const Settings: React.FC = () => {
  const { user } = useAuth();
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);

  useEffect(() => {
    const loadSettings = async () => {
      if (!user) return;

      const userRef = doc(db, 'users', user.uid);
      const userDoc = await getDoc(userRef);
      
      if (userDoc.exists()) {
        const settings = userDoc.data() as UserSettings;
        setNotificationsEnabled(settings.notifications?.taskReminders ?? false);
      }
    };

    loadSettings();
  }, [user]);

  const handleNotificationChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!user) return;

    const enabled = event.target.checked;
    setNotificationsEnabled(enabled);
    
    try {
      await NotificationService.updateNotificationSettings(user.uid, enabled);
      if (enabled) {
        // Initialize notifications when enabled
        await NotificationService.initialize(user.uid);
      }
    } catch (error) {
      console.error('Error updating notification settings:', error);
      // Revert the switch if there was an error
      setNotificationsEnabled(!enabled);
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h5" gutterBottom>
        Account Settings
      </Typography>
      
      <Card sx={{ mt: 2 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Notifications
          </Typography>
          <FormControlLabel
            control={
              <Switch
                checked={notificationsEnabled}
                onChange={handleNotificationChange}
                color="primary"
              />
            }
            label="Task Reminders (1 hour before due date)"
          />
          <Typography variant="body2" color="textSecondary" sx={{ mt: 1, mb: 3 }}>
            Receive notifications one hour before your tasks are due
          </Typography>
          
          <Divider sx={{ my: 2 }} />
          
          {notificationsEnabled && (
            <>
              <Typography variant="h6" gutterBottom>
                Test Notifications
              </Typography>
              <NotificationTest />
            </>
          )}
        </CardContent>
      </Card>
    </Box>
  );
};
