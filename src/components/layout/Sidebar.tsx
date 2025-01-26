import React from 'react';
import {
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Box,
  useTheme,
  useMediaQuery,
} from '@mui/material';
import {
  Dashboard as DashboardIcon,
  Assignment as TasksIcon,
  Settings as SettingsIcon,
} from '@mui/icons-material';

interface SidebarProps {
  mobileOpen: boolean;
  onMobileClose: () => void;
  currentSection: string;
  onSectionChange: (section: string) => void;
}

const drawerWidth = 240;

const Sidebar: React.FC<SidebarProps> = ({
  mobileOpen,
  onMobileClose,
  currentSection,
  onSectionChange,
}) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const menuItems = [
    { text: 'Dashboard', icon: <DashboardIcon />, value: 'dashboard' },
    { text: 'Tasks', icon: <TasksIcon />, value: 'tasks' },
    { text: 'Settings', icon: <SettingsIcon />, value: 'settings' },
  ];

  const drawer = (
    <Box sx={{ mt: 1 }}>
      <List>
        {menuItems.map((item) => (
          <ListItem key={item.value} disablePadding>
            <ListItemButton
              selected={currentSection === item.value}
              onClick={() => onSectionChange(item.value)}
              sx={{
                borderRadius: '0 20px 20px 0',
                mx: 1,
                transition: 'all 0.2s ease-in-out',
                '&.Mui-selected': {
                  bgcolor: 'primary.main',
                  color: 'white',
                  '&:hover': {
                    bgcolor: 'primary.dark',
                  },
                  '& .MuiListItemIcon-root': {
                    color: 'white',
                  },
                },
                '&:hover': {
                  bgcolor: 'primary.light',
                  color: 'white',
                  '& .MuiListItemIcon-root': {
                    color: 'white',
                  },
                },
              }}
            >
              <ListItemIcon
                sx={{
                  minWidth: 40,
                  color: currentSection === item.value ? 'white' : 'inherit',
                  transition: 'color 0.2s ease-in-out',
                }}
              >
                {item.icon}
              </ListItemIcon>
              <ListItemText 
                primary={item.text}
                sx={{
                  '& .MuiTypography-root': {
                    fontWeight: currentSection === item.value ? 600 : 400,
                    transition: 'font-weight 0.2s ease-in-out',
                  },
                }}
              />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
    </Box>
  );

  return (
    <Box
      component="nav"
      sx={{
        width: { sm: drawerWidth },
        flexShrink: { sm: 0 },
      }}
    >
      <Drawer
        variant={isMobile ? 'temporary' : 'permanent'}
        open={mobileOpen}
        onClose={onMobileClose}
        ModalProps={{
          keepMounted: true, // Better mobile performance
        }}
        sx={{
          '& .MuiDrawer-paper': {
            width: drawerWidth,
            boxSizing: 'border-box',
            borderRight: 'none',
            boxShadow: '2px 0 8px rgba(0, 0, 0, 0.05)',
            transition: theme.transitions.create(['transform', 'width', 'margin'], {
              easing: theme.transitions.easing.sharp,
              duration: theme.transitions.duration.enteringScreen,
            }),
          },
        }}
      >
        {drawer}
      </Drawer>
    </Box>
  );
};

export default Sidebar;
