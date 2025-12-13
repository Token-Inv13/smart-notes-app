import { useState } from 'react';
import {
  Box,
  Drawer,
  AppBar,
  Toolbar,
  Typography,
  IconButton,
  List,
  ListItemIcon,
  ListItemText,
  Container,
  ListItemButton,
} from '@mui/material';
import {
  Menu as MenuIcon,
  Note as NoteIcon,
  Assignment as TaskIcon,
  Folder as WorkspaceIcon,
  Settings as SettingsIcon,
  ExitToApp as LogoutIcon,
} from '@mui/icons-material';
import { useDispatch, useSelector } from 'react-redux';
import { auth } from '../services/firebase';
import { signOut } from 'firebase/auth';
import { logout } from '../features/auth/authSlice';
import { RootState } from '../store';
import NotesView from '../components/notes/NotesView';

const drawerWidth = 240;

const Dashboard = () => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const dispatch = useDispatch();
  const { user } = useSelector((state: RootState) => state.auth);

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen);
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      dispatch(logout());
    } catch (error) {
      console.error('Error logging out:', error);
    }
  };

  const drawer = (
    <div>
      <Toolbar />
      <List>
        <ListItemButton>
          <ListItemIcon>
            <NoteIcon />
          </ListItemIcon>
          <ListItemText primary="Notes" />
        </ListItemButton>
        <ListItemButton>
          <ListItemIcon>
            <TaskIcon />
          </ListItemIcon>
          <ListItemText primary="Tasks" />
        </ListItemButton>
        <ListItemButton>
          <ListItemIcon>
            <WorkspaceIcon />
          </ListItemIcon>
          <ListItemText primary="Workspaces" />
        </ListItemButton>
        <ListItemButton>
          <ListItemIcon>
            <SettingsIcon />
          </ListItemIcon>
          <ListItemText primary="Settings" />
        </ListItemButton>
        <ListItemButton onClick={handleLogout}>
          <ListItemIcon>
            <LogoutIcon />
          </ListItemIcon>
          <ListItemText primary="Logout" />
        </ListItemButton>
      </List>
    </div>
  );

  if (!user) {
    return null;
  }

  return (
    <Box sx={{ display: 'flex' }}>
      <AppBar
        position="fixed"
        sx={{
          width: { sm: `calc(100% - ${drawerWidth}px)` },
          ml: { sm: `${drawerWidth}px` },
        }}
      >
        <Toolbar>
          <IconButton
            color="inherit"
            aria-label="open drawer"
            edge="start"
            onClick={handleDrawerToggle}
            sx={{ mr: 2, display: { sm: 'none' } }}
          >
            <MenuIcon />
          </IconButton>
          <Typography variant="h6" noWrap component="div">
            Smart Notes
          </Typography>
        </Toolbar>
      </AppBar>
      <Box
        component="nav"
        sx={{ width: { sm: drawerWidth }, flexShrink: { sm: 0 } }}
      >
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={handleDrawerToggle}
          ModalProps={{
            keepMounted: true,
          }}
          sx={{
            display: { xs: 'block', sm: 'none' },
            '& .MuiDrawer-paper': {
              boxSizing: 'border-box',
              width: drawerWidth,
            },
          }}
        >
          {drawer}
        </Drawer>
        <Drawer
          variant="permanent"
          sx={{
            display: { xs: 'none', sm: 'block' },
            '& .MuiDrawer-paper': {
              boxSizing: 'border-box',
              width: drawerWidth,
            },
          }}
          open
        >
          {drawer}
        </Drawer>
      </Box>
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: 3,
          width: { sm: `calc(100% - ${drawerWidth}px)` },
          height: '100vh',
          overflow: 'auto',
        }}
      >
        <Toolbar />
        <Container maxWidth="xl" sx={{ height: 'calc(100% - 64px)' }}>
          <NotesView workspaceId={user.workspaces[0] || 'default'} />
        </Container>
      </Box>
    </Box>
  );
};

export default Dashboard;
