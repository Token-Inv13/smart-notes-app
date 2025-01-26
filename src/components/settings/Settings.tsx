import React, { useState } from 'react';
import {
  Box,
  Container,
  Card,
  CardContent,
  Typography,
  TextField,
  Button,
  Switch,
  FormControlLabel,
  Divider,
  Snackbar,
  Alert,
} from '@mui/material';
import { DarkMode as DarkModeIcon } from '@mui/icons-material';
import { useThemeMode } from '../../hooks/useThemeMode';
import { auth } from '../../services/firebase';
import Layout from '../layout/Layout';
import { updateEmail, updatePassword } from 'firebase/auth';

interface SettingsProps {
  currentSection: string;
  onSectionChange: (section: string) => void;
}

const Settings: React.FC<SettingsProps> = ({ currentSection, onSectionChange }) => {
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error'>('success');
  const [showMessage, setShowMessage] = useState(false);
  const { darkMode, toggleDarkMode } = useThemeMode();

  const handleUpdateEmail = async () => {
    if (!auth.currentUser) return;
    try {
      await updateEmail(auth.currentUser, newEmail);
      setMessage('Email updated successfully');
      setMessageType('success');
      setShowMessage(true);
      setNewEmail('');
    } catch (error: any) {
      setMessage(`Error updating email: ${error.message}`);
      setMessageType('error');
      setShowMessage(true);
    }
  };

  const handleUpdatePassword = async () => {
    if (!auth.currentUser) return;
    try {
      await updatePassword(auth.currentUser, newPassword);
      setMessage('Password updated successfully');
      setMessageType('success');
      setShowMessage(true);
      setNewPassword('');
    } catch (error: any) {
      setMessage(`Error updating password: ${error.message}`);
      setMessageType('error');
      setShowMessage(true);
    }
  };

  return (
    <Layout currentSection={currentSection} onSectionChange={onSectionChange}>
      <Container maxWidth="md">
        <Box sx={{ mb: 4 }}>
          <Typography variant="h5" gutterBottom>
            Account Settings
          </Typography>
        </Box>

        <Card>
          <CardContent>
            <Box>
              <Typography variant="h6" gutterBottom>
                Email Settings
              </Typography>
              <Box sx={{ mb: 3 }}>
                <TextField
                  fullWidth
                  label="New Email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  type="email"
                  sx={{ mb: 2 }}
                />
                <Button
                  variant="contained"
                  onClick={handleUpdateEmail}
                  disabled={!newEmail}
                >
                  Update Email
                </Button>
              </Box>
            </Box>

            <Divider sx={{ my: 4 }} />

            <Box>
              <Typography variant="h6" gutterBottom>
                Password Settings
              </Typography>
              <Box sx={{ mb: 3 }}>
                <TextField
                  fullWidth
                  label="New Password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  type="password"
                  sx={{ mb: 2 }}
                />
                <Button
                  variant="contained"
                  onClick={handleUpdatePassword}
                  disabled={!newPassword}
                >
                  Update Password
                </Button>
              </Box>
            </Box>

            <Divider sx={{ my: 4 }} />

            <Box>
              <Typography variant="h6" gutterBottom>
                Appearance
              </Typography>
              <FormControlLabel
                control={
                  <Switch
                    checked={darkMode}
                    onChange={toggleDarkMode}
                    color="primary"
                  />
                }
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <DarkModeIcon />
                    <Typography>Dark Mode</Typography>
                  </Box>
                }
              />
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Toggle between light and dark themes. Your preference will be saved automatically.
              </Typography>
            </Box>
          </CardContent>
        </Card>

        <Snackbar
          open={showMessage}
          autoHideDuration={6000}
          onClose={() => setShowMessage(false)}
        >
          <Alert severity={messageType} onClose={() => setShowMessage(false)}>
            {message}
          </Alert>
        </Snackbar>
      </Container>
    </Layout>
  );
};

export default Settings;
