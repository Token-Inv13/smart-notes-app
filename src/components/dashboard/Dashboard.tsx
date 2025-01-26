import React, { useState, useEffect, useCallback } from 'react';
import { auth, db } from '../../services/firebase';
import {
  collection,
  addDoc,
  query,
  getDocs,
  where,
  DocumentData
} from 'firebase/firestore';
import {
  Box,
  Container,
  Grid,
  Card,
  Typography,
  TextField,
  Button,
  IconButton,
  Alert,
  Fade,
  CircularProgress,
} from '@mui/material';
import {
  Create as CreateIcon,
  Search as SearchIcon,
  FilterList as FilterListIcon,
  Sort as SortIcon,
} from '@mui/icons-material';
import Layout from '../layout/Layout';

interface Note extends DocumentData {
  id: string;
  content: string;
  userId: string;
  createdAt: string;
}

interface DashboardProps {
  currentSection: string;
  onSectionChange: (section: string) => void;
}

const Dashboard: React.FC<DashboardProps> = ({ currentSection, onSectionChange }) => {
  const [noteContent, setNoteContent] = useState('');
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error' | 'info'>('info');
  const [searchQuery, setSearchQuery] = useState('');

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
    loadNotes();
  }, [loadNotes]);

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
      setNoteContent('');
      loadNotes();
    } catch (error) {
      const err = error as Error;
      showMessage(`Error creating note: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const filteredNotes = notes.filter(note => 
    note.content.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <Layout currentSection={currentSection} onSectionChange={onSectionChange}>
      <Container maxWidth="lg">
        <Grid container spacing={3}>
          {/* Create Note Section */}
          <Grid item xs={12} md={4}>
            <Card
              elevation={0}
              sx={{
                p: 3,
                bgcolor: 'white',
                borderRadius: 2
              }}
            >
              <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CreateIcon fontSize="small" /> Create Note
              </Typography>
              <TextField
                placeholder="What's on your mind?"
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
                fullWidth
                multiline
                rows={4}
                size="small"
                sx={{ mb: 2 }}
              />
              <Button
                variant="contained"
                onClick={handleCreateNote}
                disabled={loading}
                fullWidth
                sx={{ textTransform: 'none' }}
              >
                Save Note
              </Button>

              <Fade in={!!message}>
                <Alert 
                  severity={messageType}
                  sx={{ mt: 2 }}
                >
                  {message}
                </Alert>
              </Fade>
            </Card>
          </Grid>

          {/* Notes List Section */}
          <Grid item xs={12} md={8}>
            <Card
              elevation={0}
              sx={{
                p: 3,
                bgcolor: 'white',
                borderRadius: 2
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
                <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <CreateIcon fontSize="small" /> Your Notes
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
                  <IconButton size="small">
                    <FilterListIcon />
                  </IconButton>
                  <IconButton size="small">
                    <SortIcon />
                  </IconButton>
                </Box>
              </Box>
              
              {loading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
                  <CircularProgress size={24} />
                </Box>
              ) : filteredNotes.length > 0 ? (
                <Grid container spacing={2}>
                  {filteredNotes.map((note) => (
                    <Grid item xs={12} key={note.id}>
                      <Card
                        elevation={0}
                        sx={{
                          p: 2,
                          bgcolor: '#f8f9fa'
                        }}
                      >
                        <Typography variant="body1" sx={{ mb: 1 }}>
                          {note.content}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {new Date(note.createdAt).toLocaleString()}
                        </Typography>
                      </Card>
                    </Grid>
                  ))}
                </Grid>
              ) : (
                <Box
                  sx={{
                    p: 4,
                    textAlign: 'center',
                    bgcolor: '#f8f9fa',
                    borderRadius: 2
                  }}
                >
                  <Typography variant="body1" color="text.secondary">
                    {searchQuery ? 'No notes match your search' : 'No notes yet. Create your first note!'}
                  </Typography>
                </Box>
              )}
            </Card>
          </Grid>
        </Grid>
      </Container>
    </Layout>
  );
};

export default Dashboard;
