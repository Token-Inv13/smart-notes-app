import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { Note } from '../../types';

interface NotesState {
  items: Note[];
  selectedNote: Note | null;
  loading: boolean;
  error: string | null;
}

const initialState: NotesState = {
  items: [],
  selectedNote: null,
  loading: false,
  error: null,
};

const notesSlice = createSlice({
  name: 'notes',
  initialState,
  reducers: {
    setNotes: (state, action: PayloadAction<Note[]>) => {
      state.items = action.payload;
      state.loading = false;
      state.error = null;
    },
    addNote: (state, action: PayloadAction<Note>) => {
      state.items.push(action.payload);
    },
    updateNote: (state, action: PayloadAction<Note>) => {
      const index = state.items.findIndex((note) => note.id === action.payload.id);
      if (index !== -1) {
        state.items[index] = action.payload;
      }
    },
    deleteNote: (state, action: PayloadAction<string>) => {
      state.items = state.items.filter((note) => note.id !== action.payload);
    },
    setSelectedNote: (state, action: PayloadAction<Note | null>) => {
      state.selectedNote = action.payload;
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload;
    },
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
      state.loading = false;
    },
  },
});

export const {
  setNotes,
  addNote,
  updateNote,
  deleteNote,
  setSelectedNote,
  setLoading,
  setError,
} = notesSlice.actions;

export default notesSlice.reducer;
