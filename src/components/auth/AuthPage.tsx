import React, { useState } from 'react';
import { auth } from '../../services/firebase';
import { 
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  AuthError
} from 'firebase/auth';
import {
  Box,
  Container,
  Card,
  Typography,
  TextField,
  Button,
  Alert,
  Fade,
} from '@mui/material';

const AuthPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [messageType, setMessageType] = useState<'success' | 'error' | 'info'>('info');
  const [isSignIn, setIsSignIn] = useState(true);

  const showMessage = (text: string, type: 'success' | 'error' | 'info') => {
    setMessage(text);
    setMessageType(type);
  };

  const handleAuth = async () => {
    if (!email || !password) {
      showMessage('Please fill in all fields', 'error');
      return;
    }

    try {
      setLoading(true);
      if (isSignIn) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
      }
    } catch (error) {
      const err = error as AuthError;
      showMessage(`Error: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: '#f8f9fa'
      }}
    >
      <Container maxWidth="sm" sx={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <Box sx={{ mb: 4, textAlign: 'center' }}>
          <Typography
            variant="h4"
            component="h1"
            sx={{
              color: '#2196f3',
              fontWeight: 500,
              mb: 1
            }}
          >
            Smart Notes
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Your personal space for thoughts and ideas
          </Typography>
        </Box>

        <Card
          elevation={0}
          sx={{
            p: 3,
            bgcolor: 'white',
            borderRadius: 2
          }}
        >
          <Box sx={{ display: 'flex', gap: 1, mb: 3 }}>
            <Button
              variant={isSignIn ? 'contained' : 'text'}
              onClick={() => setIsSignIn(true)}
              sx={{ 
                flex: 1,
                color: isSignIn ? 'white' : '#2196f3',
                textTransform: 'none',
                py: 1
              }}
            >
              Sign In
            </Button>
            <Button
              variant={!isSignIn ? 'contained' : 'text'}
              onClick={() => setIsSignIn(false)}
              sx={{ 
                flex: 1,
                color: !isSignIn ? 'white' : '#2196f3',
                textTransform: 'none',
                py: 1
              }}
            >
              Create Account
            </Button>
          </Box>

          <Fade in={!!message}>
            <Alert 
              severity={messageType}
              sx={{ mb: 2 }}
            >
              {message}
            </Alert>
          </Fade>

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              placeholder="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              fullWidth
              size="small"
              autoComplete="email"
            />
            <TextField
              placeholder="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              fullWidth
              size="small"
              autoComplete={isSignIn ? 'current-password' : 'new-password'}
            />
            <Button
              variant="contained"
              onClick={handleAuth}
              disabled={loading}
              sx={{ 
                py: 1,
                textTransform: 'none'
              }}
              fullWidth
            >
              {isSignIn ? 'Sign In' : 'Create Account'}
            </Button>
          </Box>
        </Card>
      </Container>
    </Box>
  );
};

export default AuthPage;
