import React, { useState } from 'react';
import { Button, Box, Alert, CircularProgress } from '@mui/material';
import { useAuth } from '../hooks/useAuth';
import { createTestTask } from '../utils/testNotification';
import { getFCMToken } from '../services/firebase';

export const NotificationTest: React.FC = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleTest = async () => {
    if (!user) {
      setError('Vous devez être connecté pour tester les notifications');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      // Vérifier d'abord que nous avons un token FCM
      const token = await getFCMToken();
      if (!token) {
        throw new Error('Impossible d\'obtenir le token FCM. Vérifiez que vous avez autorisé les notifications.');
      }

      // Créer la tâche test
      const taskId = await createTestTask(user.uid);
      setSuccess(`Tâche test créée (ID: ${taskId}). Vous devriez recevoir une notification dans environ 5 minutes.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue lors du test');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {success && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {success}
        </Alert>
      )}
      <Button
        variant="contained"
        onClick={handleTest}
        disabled={loading || !user}
        startIcon={loading ? <CircularProgress size={20} /> : null}
      >
        Tester les notifications
      </Button>
    </Box>
  );
};
