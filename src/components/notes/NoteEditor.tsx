import { useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import {
  Paper,
  TextField,
  Button,
  Box,
  Typography,
  Chip,
  IconButton,
} from '@mui/material';
import {
  Save as SaveIcon,
  Add as AddIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import { RootState } from '../../store';
import { Note } from '../../types';
import { updateNote, addNote } from '../../features/notes/notesSlice';
import {
  createNote as createNoteService,
  updateNote as updateNoteService,
} from '../../services/notesService';

interface NoteEditorProps {
  noteId?: string;
  workspaceId: string;
  onClose?: () => void;
}

const NoteEditor: React.FC<NoteEditorProps> = ({
  noteId,
  workspaceId,
  onClose,
}) => {
  const dispatch = useDispatch();
  const { user } = useSelector((state: RootState) => state.auth);
  const notes = useSelector((state: RootState) => state.notes.items);
  
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');

  useEffect(() => {
    if (noteId) {
      const note = notes.find((n) => n.id === noteId);
      if (note) {
        setTitle(note.title);
        setContent(note.content);
        setTags(note.tags);
      }
    }
  }, [noteId, notes]);

  const handleSave = async () => {
    if (!user) return;

    const noteData = {
      title,
      content,
      tags,
      userId: user.id,
      workspaceId,
    };

    try {
      if (noteId) {
        await updateNoteService(noteId, noteData);
        dispatch(
          updateNote({
            id: noteId,
            ...noteData,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
        );
      } else {
        const newNote = await createNoteService({
          ...noteData,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        dispatch(addNote(newNote));
      }

      if (onClose) {
        onClose();
      }
    } catch (error) {
      console.error('Error saving note:', error);
    }
  };

  const handleAddTag = () => {
    if (newTag.trim() && !tags.includes(newTag.trim())) {
      setTags([...tags, newTag.trim()]);
      setNewTag('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((tag) => tag !== tagToRemove));
  };

  return (
    <Paper sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h6">
          {noteId ? 'Edit Note' : 'Create New Note'}
        </Typography>
        {onClose && (
          <IconButton onClick={onClose}>
            <CloseIcon />
          </IconButton>
        )}
      </Box>

      <TextField
        fullWidth
        label="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        margin="normal"
        variant="outlined"
      />

      <TextField
        fullWidth
        label="Content"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        margin="normal"
        variant="outlined"
        multiline
        rows={6}
      />

      <Box sx={{ mt: 2, mb: 1 }}>
        <Typography variant="subtitle1" gutterBottom>
          Tags
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1 }}>
          {tags.map((tag) => (
            <Chip
              key={tag}
              label={tag}
              onDelete={() => handleRemoveTag(tag)}
              size="small"
            />
          ))}
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <TextField
            size="small"
            label="Add tag"
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAddTag();
              }
            }}
          />
          <Button
            startIcon={<AddIcon />}
            onClick={handleAddTag}
            variant="outlined"
            size="small"
          >
            Add
          </Button>
        </Box>
      </Box>

      <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          variant="contained"
          startIcon={<SaveIcon />}
          onClick={handleSave}
          disabled={!title.trim() || !content.trim()}
        >
          Save
        </Button>
      </Box>
    </Paper>
  );
};

export default NoteEditor;
