import { useState } from 'react';
import { useSelector } from 'react-redux';
import {
  Grid,
  Fab,
  Dialog,
  useMediaQuery,
  useTheme,
  Box,
} from '@mui/material';
import { Add as AddIcon } from '@mui/icons-material';
import { RootState } from '../../store';
import NoteList from './NoteList';
import NoteEditor from './NoteEditor';

interface NotesViewProps {
  workspaceId: string;
}

const NotesView: React.FC<NotesViewProps> = ({ workspaceId }) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const selectedNote = useSelector((state: RootState) => state.notes.selectedNote);
  
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | undefined>();

  const handleCreateNote = () => {
    setEditingNoteId(undefined);
    setIsEditorOpen(true);
  };

  const handleEditNote = (noteId: string) => {
    setEditingNoteId(noteId);
    setIsEditorOpen(true);
  };

  const handleCloseEditor = () => {
    setIsEditorOpen(false);
    setEditingNoteId(undefined);
  };

  const renderEditor = () => (
    <NoteEditor
      noteId={editingNoteId}
      workspaceId={workspaceId}
      onClose={isMobile ? handleCloseEditor : undefined}
    />
  );

  return (
    <Box sx={{ position: 'relative', height: '100%' }}>
      <Grid container spacing={2} sx={{ height: '100%' }}>
        <Grid item xs={12} md={4}>
          <NoteList workspaceId={workspaceId} onEditNote={handleEditNote} />
        </Grid>
        
        {!isMobile && (
          <Grid item xs={12} md={8}>
            {(isEditorOpen || selectedNote) && renderEditor()}
          </Grid>
        )}
      </Grid>

      {isMobile && (
        <Dialog
          open={isEditorOpen}
          onClose={handleCloseEditor}
          fullScreen
          PaperProps={{
            sx: { bgcolor: 'background.default' },
          }}
        >
          {renderEditor()}
        </Dialog>
      )}

      <Fab
        color="primary"
        aria-label="add note"
        onClick={handleCreateNote}
        sx={{
          position: 'fixed',
          bottom: (theme) => theme.spacing(3),
          right: (theme) => theme.spacing(3),
        }}
      >
        <AddIcon />
      </Fab>
    </Box>
  );
};

export default NotesView;
