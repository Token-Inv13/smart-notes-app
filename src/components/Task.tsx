import React, { useState, useEffect } from 'react';
import {
  Box,
  TextField,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Stack,
  Typography,
  FormControlLabel,
  Switch,
  Alert
} from '@mui/material';
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { useAuth } from '../hooks/useAuth';
import { db } from '../services/firebase';
import { collection, addDoc, doc, getDoc, updateDoc } from 'firebase/firestore';
import { NotificationService } from '../services/notificationService';
import { Task as TaskType } from '../types/task';

interface TaskFormProps {
  taskId?: string;
  onSuccess?: () => void;
}

export const TaskForm: React.FC<TaskFormProps> = ({ taskId, onSuccess }) => {
  const { user } = useAuth();
  const [formData, setFormData] = useState<Partial<TaskType>>({
    title: '',
    description: '',
    dueDate: new Date().toISOString(),
    priority: 'medium',
    completed: false,
    reminder: {
      enabled: false,
      time: new Date().toISOString()
    }
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);

  useEffect(() => {
    const loadTask = async () => {
      if (!taskId || !user) return;

      try {
        const taskDoc = await getDoc(doc(db, 'tasks', taskId));
        if (taskDoc.exists()) {
          setFormData(taskDoc.data() as TaskType);
        }
      } catch (err) {
        console.error('Error loading task:', err);
        setError('Error loading task');
      }
    };

    const checkNotificationSettings = async () => {
      if (!user) return;
      
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      if (userDoc.exists()) {
        const userData = userDoc.data();
        setNotificationsEnabled(userData?.settings?.notifications?.taskReminders ?? false);
      }
    };

    loadTask();
    checkNotificationSettings();
  }, [taskId, user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setLoading(true);
    setError(null);

    try {
      const taskData: Partial<TaskType> = {
        ...formData,
        userId: user.uid,
        createdAt: formData.createdAt || new Date().toISOString()
      };

      if (taskId) {
        await updateDoc(doc(db, 'tasks', taskId), taskData);
      } else {
        const taskRef = await addDoc(collection(db, 'tasks'), taskData);
        taskId = taskRef.id;
      }

      if (formData.reminder?.enabled && notificationsEnabled) {
        const reminderTime = new Date(formData.reminder.time);
        await NotificationService.scheduleTaskReminder(
          user.uid,
          taskId!,
          reminderTime
        );
      }

      if (onSuccess) {
        onSuccess();
      }
    } catch (err) {
      console.error('Error saving task:', err);
      setError('Error saving task');
    } finally {
      setLoading(false);
    }
  };

  const handleReminderToggle = (event: React.ChangeEvent<HTMLInputElement>) => {
    const enabled = event.target.checked;
    setFormData(prev => ({
      ...prev,
      reminder: {
        enabled,
        time: prev.reminder?.time || prev.dueDate || new Date().toISOString()
      }
    }));
  };

  const handleReminderTimeChange = (newValue: Date | null) => {
    if (!newValue) return;
    
    setFormData(prev => ({
      ...prev,
      reminder: {
        ...prev.reminder!,
        time: newValue.toISOString()
      }
    }));
  };

  return (
    <LocalizationProvider dateAdapter={AdapterDateFns}>
      <Box component="form" onSubmit={handleSubmit} sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom>
          {taskId ? 'Edit Task' : 'Create New Task'}
        </Typography>
        
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        
        <Stack spacing={3}>
          <TextField
            label="Title"
            value={formData.title}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            required
            fullWidth
          />

          <TextField
            label="Description"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            multiline
            rows={3}
            fullWidth
          />

          <DateTimePicker
            label="Due Date"
            value={new Date(formData.dueDate || new Date())}
            onChange={(newValue) => newValue && setFormData({ ...formData, dueDate: newValue.toISOString() })}
            slotProps={{
              textField: {
                required: true,
                fullWidth: true
              }
            }}
          />

          <FormControl fullWidth>
            <InputLabel>Priority</InputLabel>
            <Select
              value={formData.priority}
              label="Priority"
              onChange={(e) => setFormData({ ...formData, priority: e.target.value as TaskType['priority'] })}
            >
              <MenuItem value="low">Low</MenuItem>
              <MenuItem value="medium">Medium</MenuItem>
              <MenuItem value="high">High</MenuItem>
            </Select>
          </FormControl>

          <Box sx={{ 
            bgcolor: 'background.paper', 
            p: 2, 
            borderRadius: 1,
            border: 1,
            borderColor: 'divider'
          }}>
            <FormControlLabel
              control={
                <Switch
                  checked={formData.reminder?.enabled || false}
                  onChange={handleReminderToggle}
                  disabled={!notificationsEnabled}
                  color="primary"
                />
              }
              label={
                <Box>
                  <Typography variant="body1">
                    Enable Reminder
                  </Typography>
                  {!notificationsEnabled && (
                    <Typography variant="caption" color="text.secondary" display="block">
                      Enable notifications in settings to use reminders
                    </Typography>
                  )}
                </Box>
              }
            />
            
            {formData.reminder?.enabled && (
              <Box sx={{ mt: 2 }}>
                <DateTimePicker
                  label="Reminder Time"
                  value={new Date(formData.reminder.time)}
                  onChange={handleReminderTimeChange}
                  minDateTime={new Date()}
                  slotProps={{
                    textField: {
                      fullWidth: true,
                      helperText: 'When should we remind you?',
                      required: true
                    }
                  }}
                />
              </Box>
            )}
          </Box>

          <Button
            type="submit"
            variant="contained"
            color="primary"
            disabled={loading}
            fullWidth
          >
            {loading ? 'Saving...' : (taskId ? 'Update Task' : 'Create Task')}
          </Button>
        </Stack>
      </Box>
    </LocalizationProvider>
  );
};
