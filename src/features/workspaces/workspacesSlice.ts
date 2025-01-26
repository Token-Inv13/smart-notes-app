import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface Workspace {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  members: string[];
  createdAt: string;
  updatedAt: string;
}

interface WorkspacesState {
  workspaces: Workspace[];
  loading: boolean;
  error: string | null;
  selectedWorkspace: Workspace | null;
}

const initialState: WorkspacesState = {
  workspaces: [],
  loading: false,
  error: null,
  selectedWorkspace: null,
};

const workspacesSlice = createSlice({
  name: 'workspaces',
  initialState,
  reducers: {
    setWorkspaces: (state, action: PayloadAction<Workspace[]>) => {
      state.workspaces = action.payload;
      state.loading = false;
      state.error = null;
    },
    addWorkspace: (state, action: PayloadAction<Workspace>) => {
      state.workspaces.push(action.payload);
    },
    updateWorkspace: (state, action: PayloadAction<Workspace>) => {
      const index = state.workspaces.findIndex(workspace => workspace.id === action.payload.id);
      if (index !== -1) {
        state.workspaces[index] = action.payload;
      }
    },
    deleteWorkspace: (state, action: PayloadAction<string>) => {
      state.workspaces = state.workspaces.filter(workspace => workspace.id !== action.payload);
    },
    setSelectedWorkspace: (state, action: PayloadAction<Workspace | null>) => {
      state.selectedWorkspace = action.payload;
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
  setWorkspaces,
  addWorkspace,
  updateWorkspace,
  deleteWorkspace,
  setSelectedWorkspace,
  setLoading,
  setError,
} = workspacesSlice.actions;

export default workspacesSlice.reducer;
