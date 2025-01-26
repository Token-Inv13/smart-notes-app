import { configureStore } from '@reduxjs/toolkit';
import authReducer from '../features/auth/authSlice';
import notesReducer from '../features/notes/notesSlice';
import tasksReducer from '../features/tasks/tasksSlice';
import workspacesReducer from '../features/workspaces/workspacesSlice';
import uiReducer from '../features/ui/uiSlice';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    notes: notesReducer,
    tasks: tasksReducer,
    workspaces: workspacesReducer,
    ui: uiReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: ['payload.timestamp', 'payload.dueDate'],
        ignoredPaths: ['notes.items.createdAt', 'notes.items.updatedAt'],
      },
    }),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
