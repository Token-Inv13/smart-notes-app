import React, { useState, useEffect, useCallback } from 'react';
import { auth, db } from '../../services/firebase';
import { 
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  AuthError
} from 'firebase/auth';
import {
  collection,
  addDoc,
  query,
  getDocs,
  where,
  DocumentData
} from 'firebase/firestore';
import {
  Button,
  TextField,
  Box,
  Typography,
  Container,
  Grid,
  Divider,
  Alert,
  Fade,
  CircularProgress,
  Card,
  CardContent,
  useTheme,
  alpha,
  IconButton,
  Tooltip,
  Zoom
} from '@mui/material';
import {
  NoteAdd as NoteAddIcon,
  Login as LoginIcon,
  Logout as LogoutIcon,
  PersonAdd as PersonAddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Search as SearchIcon,
  FilterList as FilterListIcon,
  Sort as SortIcon
} from '@mui/icons-material';

interface Note extends DocumentData {
  id: string;
  content: string;
  userId: string;
  createdAt: string;
}

const FirebaseTest: React.FC = () => {
  const theme = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(false);
  const [messageType, setMessageType] = useState<'success' | 'error' | 'info'>('info');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredNotes = notes.filter(note => 
    note.content.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const showMessage = (text: string, type: 'success' | 'error' | 'info') => {
    setMessage(text);
    setMessageType(type);
  };

  const loadNotes = useCallback(async () => {
    if (!auth.currentUser) return;
    setLoading(true);

    try {
      const q = query(
        collection(db, 'notes'),
        where('userId', '==', auth.currentUser.uid)
      );

      const querySnapshot = await getDocs(q);
      const notesList = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Note[];
      setNotes(notesList);
    } catch (error) {
      const err = error as Error;
      showMessage(`Error loading notes: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (user) {
        setMessage(`Welcome back, ${user.email}`);
        setMessageType('success');
        loadNotes();
      } else {
        setMessage('Please sign in to manage your notes');
        setMessageType('info');
        setNotes([]);
      }
    });

    return () => unsubscribe();
  }, [loadNotes]);

  const handleSignUp = async () => {
    try {
      setLoading(true);
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      showMessage(`Welcome to Smart Notes, ${userCredential.user.email}!`, 'success');
    } catch (error) {
      const err = error as AuthError;
      showMessage(`Error signing up: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSignIn = async () => {
    try {
      setLoading(true);
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      showMessage(`Welcome back, ${userCredential.user.email}!`, 'success');
    } catch (error) {
      const err = error as AuthError;
      showMessage(`Error signing in: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      setLoading(true);
      await signOut(auth);
      showMessage('Signed out successfully', 'success');
    } catch (error) {
      const err = error as Error;
      showMessage(`Error signing out: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateNote = async () => {
    if (!auth.currentUser) {
      showMessage('Please sign in first', 'error');
      return;
    }

    if (!noteContent.trim()) {
      showMessage('Please enter some content for your note', 'error');
      return;
    }

    try {
      setLoading(true);
      await addDoc(collection(db, 'notes'), {
        content: noteContent,
        userId: auth.currentUser.uid,
        createdAt: new Date().toISOString()
      });
      showMessage('Note created successfully!', 'success');
      setNoteContent('');
      loadNotes();
    } catch (error) {
      const err = error as Error;
      showMessage(`Error creating note: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
        pt: { xs: 2, sm: 4 },
        pb: { xs: 4, sm: 6 }
      }}
    >
      <Container maxWidth="lg">
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          {/* Header */}
          <Card
            elevation={0}
            sx={{
              background: 'transparent',
              backgroundImage: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.08)} 0%, ${alpha(theme.palette.secondary.main, 0.08)} 100%)`,
              backdropFilter: 'blur(8px)',
              border: '1px solid',
              borderColor: alpha(theme.palette.primary.main, 0.1),
              p: { xs: 3, sm: 4 },
              textAlign: 'center'
            }}
          >
            <Typography
              variant="h4"
              component="h1"
              sx={{
                background: `linear-gradient(45deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
                backgroundClip: 'text',
                WebkitBackgroundClip: 'text',
                color: 'transparent',
                mb: 1,
                fontWeight: 700
              }}
            >
              Smart Notes
            </Typography>
            <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
              Your personal space for thoughts and ideas
            </Typography>
          </Card>

          <Grid container spacing={4}>
            {/* Auth Section */}
            <Grid item xs={12} md={4}>
              <Card
                elevation={0}
                sx={{
                  height: '100%',
                  background: 'white',
                  border: '1px solid',
                  borderColor: alpha(theme.palette.primary.main, 0.1),
                  transition: 'transform 0.2s ease-in-out',
                  '&:hover': {
                    transform: 'translateY(-2px)'
                  }
                }}
              >
                <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
                  <Typography variant="h6" gutterBottom color="primary" sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 1 }}>
                    <LoginIcon /> Authentication
                  </Typography>
                  <Box sx={{ mb: 3 }}>
                    <TextField
                      label="Email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      fullWidth
                      margin="normal"
                      size="small"
                      sx={{ mb: 2 }}
                    />
                    <TextField
                      label="Password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      fullWidth
                      margin="normal"
                      size="small"
                      sx={{ mb: 3 }}
                    />
                    <Box sx={{ display: 'flex', gap: 1, flexDirection: 'column' }}>
                      <Button
                        variant="contained"
                        onClick={handleSignUp}
                        startIcon={<PersonAddIcon />}
                        disabled={loading}
                        fullWidth
                        sx={{ py: 1.5 }}
                      >
                        Create Account
                      </Button>
                      <Button
                        variant="contained"
                        onClick={handleSignIn}
                        startIcon={<LoginIcon />}
                        disabled={loading}
                        fullWidth
                        sx={{ py: 1.5 }}
                      >
                        Sign In
                      </Button>
                      <Button
                        variant="outlined"
                        onClick={handleSignOut}
                        startIcon={<LogoutIcon />}
                        disabled={loading}
                        fullWidth
                        sx={{ py: 1.5 }}
                      >
                        Sign Out
                      </Button>
                    </Box>
                  </Box>
                </CardContent>
              </Card>
            </Grid>

            {/* Notes Section */}
            <Grid item xs={12} md={8}>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {/* Create Note Card */}
                <Card
                  elevation={0}
                  sx={{
                    background: 'white',
                    border: '1px solid',
                    borderColor: alpha(theme.palette.primary.main, 0.1),
                    transition: 'transform 0.2s ease-in-out',
                    '&:hover': {
                      transform: 'translateY(-2px)'
                    }
                  }}
                >
                  <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
                    <Typography variant="h6" gutterBottom color="primary" sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 1 }}>
                      <NoteAddIcon /> Create Note
                    </Typography>
                    <TextField
                      label="What's on your mind?"
                      placeholder="Type your note here..."
                      value={noteContent}
                      onChange={(e) => setNoteContent(e.target.value)}
                      fullWidth
                      multiline
                      rows={3}
                      size="small"
                      sx={{ mb: 2 }}
                    />
                    <Button
                      variant="contained"
                      onClick={handleCreateNote}
                      startIcon={<NoteAddIcon />}
                      disabled={loading}
                      fullWidth
                      sx={{ py: 1.5 }}
                    >
                      Save Note
                    </Button>
                  </CardContent>
                </Card>

                {/* Messages */}
                <Fade in={!!message}>
                  <Alert 
                    severity={messageType}
                    sx={{
                      borderRadius: 2,
                      boxShadow: theme.shadows[1]
                    }}
                  >
                    {message}
                  </Alert>
                </Fade>

                {/* Notes List */}
                <Card
                  elevation={0}
                  sx={{
                    background: 'white',
                    border: '1px solid',
                    borderColor: alpha(theme.palette.primary.main, 0.1)
                  }}
                >
                  <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
                      <Typography variant="h6" color="primary" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <EditIcon /> Your Notes
                      </Typography>
                      <Box sx={{ display: 'flex', gap: 1 }}>
                        <TextField
                          size="small"
                          placeholder="Search notes..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          InputProps={{
                            startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} />,
                          }}
                          sx={{ width: 200 }}
                        />
                        <Tooltip title="Filter">
                          <IconButton size="small">
                            <FilterListIcon />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Sort">
                          <IconButton size="small">
                            <SortIcon />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    </Box>
                    <Divider sx={{ mb: 3 }} />
                    
                    {loading ? (
                      <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
                        <CircularProgress size={32} />
                      </Box>
                    ) : filteredNotes.length > 0 ? (
                      <Grid container spacing={2}>
                        {filteredNotes.map((note) => (
                          <Grid item xs={12} key={note.id}>
                            <Card
                              elevation={0}
                              sx={{
                                background: alpha(theme.palette.primary.light, 0.04),
                                transition: 'all 0.3s ease',
                                '&:hover': {
                                  transform: 'translateY(-2px)',
                                  background: alpha(theme.palette.primary.light, 0.08),
                                  '& .note-actions': {
                                    opacity: 1
                                  }
                                }
                              }}
                            >
                              <CardContent>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                  <Box sx={{ flex: 1 }}>
                                    <Typography variant="body1" sx={{ mb: 1, whiteSpace: 'pre-wrap' }}>
                                      {note.content}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary">
                                      {new Date(note.createdAt).toLocaleString()}
                                    </Typography>
                                  </Box>
                                  <Box 
                                    className="note-actions"
                                    sx={{
                                      opacity: 0,
                                      transition: 'opacity 0.2s ease',
                                      display: 'flex',
                                      gap: 1
                                    }}
                                  >
                                    <Tooltip title="Edit" TransitionComponent={Zoom}>
                                      <IconButton size="small">
                                        <EditIcon fontSize="small" />
                                      </IconButton>
                                    </Tooltip>
                                    <Tooltip title="Delete" TransitionComponent={Zoom}>
                                      <IconButton size="small" color="error">
                                        <DeleteIcon fontSize="small" />
                                      </IconButton>
                                    </Tooltip>
                                  </Box>
                                </Box>
                              </CardContent>
                            </Card>
                          </Grid>
                        ))}
                      </Grid>
                    ) : (
                      <Box
                        sx={{
                          p: 4,
                          textAlign: 'center',
                          background: alpha(theme.palette.primary.light, 0.04),
                          borderRadius: 2,
                          border: '2px dashed',
                          borderColor: alpha(theme.palette.primary.main, 0.1)
                        }}
                      >
                        <Typography variant="body1" color="text.secondary">
                          {searchQuery ? 'No notes match your search' : 'No notes yet. Create your first note above!'}
                        </Typography>
                      </Box>
                    )}
                  </CardContent>
                </Card>
              </Box>
            </Grid>
          </Grid>
        </Box>
      </Container>
    </Box>
  );
};

export default FirebaseTest;
