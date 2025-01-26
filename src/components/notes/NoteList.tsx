import { useEffect, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import {
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  Paper,
  Typography,
  TextField,
  InputAdornment,
} from '@mui/material';
import {
  Delete as DeleteIcon,
  Edit as EditIcon,
  Search as SearchIcon,
} from '@mui/icons-material';
import { format } from 'date-fns';
import { RootState } from '../../store';
import { setNotes, setSelectedNote, deleteNote } from '../../features/notes/notesSlice';
import { getNotesByWorkspace, deleteNote as deleteNoteService } from '../../services/notesService';

interface NoteListProps {
  workspaceId: string;
  onEditNote: (noteId: string) => void;
}

const NoteList: React.FC<NoteListProps> = ({ workspaceId, onEditNote }) => {
  const dispatch = useDispatch();
  const { user } = useSelector((state: RootState) => state.auth);
  const { items: notes } = useSelector((state: RootState) => state.notes);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    const fetchNotes = async () => {
      if (user) {
        try {
          const fetchedNotes = await getNotesByWorkspace(workspaceId, user.id);
          dispatch(setNotes(fetchedNotes));
        } catch (error) {
          console.error('Error fetching notes:', error);
        }
      }
    };

    fetchNotes();
  }, [dispatch, workspaceId, user]);

  const handleDeleteNote = async (noteId: string) => {
    try {
      await deleteNoteService(noteId);
      dispatch(deleteNote(noteId));
    } catch (error) {
      console.error('Error deleting note:', error);
    }
  };

  const filteredNotes = notes.filter(
    (note) =>
      note.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      note.content.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <Paper sx={{ p: 2 }}>
      <TextField
        fullWidth
        variant="outlined"
        placeholder="Search notes..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        sx={{ mb: 2 }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon />
            </InputAdornment>
          ),
        }}
      />
      {filteredNotes.length === 0 ? (
        <Typography variant="body1" color="textSecondary" align="center">
          No notes found
        </Typography>
      ) : (
        <List>
          {filteredNotes.map((note) => (
            <ListItem
              key={note.id}
              button
              onClick={() => dispatch(setSelectedNote(note))}
            >
              <ListItemText
                primary={note.title}
                secondary={`Last updated: ${format(
                  new Date(note.updatedAt),
                  'MMM dd, yyyy HH:mm'
                )}`}
              />
              <ListItemSecondaryAction>
                <IconButton
                  edge="end"
                  aria-label="edit"
                  onClick={() => onEditNote(note.id)}
                  sx={{ mr: 1 }}
                >
                  <EditIcon />
                </IconButton>
                <IconButton
                  edge="end"
                  aria-label="delete"
                  onClick={() => handleDeleteNote(note.id)}
                >
                  <DeleteIcon />
                </IconButton>
              </ListItemSecondaryAction>
            </ListItem>
          ))}
        </List>
      )}
    </Paper>
  );
};

export default NoteList;
