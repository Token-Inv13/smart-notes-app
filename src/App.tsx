import React, { useState } from 'react';
import { ThemeProvider as MuiThemeProvider, CssBaseline } from '@mui/material';
import { ThemeProvider } from './contexts/ThemeContext';
import { useThemeMode } from './hooks/useThemeMode';
import { createAppTheme } from './theme';
import Dashboard from './components/dashboard/Dashboard';
import Tasks from './components/tasks/Tasks';
import Settings from './components/settings/Settings';
import AuthPage from './components/auth/AuthPage';
import { useAuth } from './hooks/useAuth';

export type Section = 'dashboard' | 'tasks' | 'settings';

const AppContent: React.FC = () => {
  const [currentSection, setCurrentSection] = useState<Section>('dashboard');
  const { user, loading } = useAuth();
  const { darkMode } = useThemeMode();
  const theme = createAppTheme(darkMode);

  const handleSectionChange = (section: string) => {
    setCurrentSection(section as Section);
  };

  if (loading) {
    return null; // Or a loading spinner
  }

  if (!user) {
    return (
      <MuiThemeProvider theme={theme}>
        <CssBaseline />
        <AuthPage />
      </MuiThemeProvider>
    );
  }

  const renderSection = () => {
    switch (currentSection) {
      case 'dashboard':
        return <Dashboard currentSection={currentSection} onSectionChange={handleSectionChange} />;
      case 'tasks':
        return <Tasks currentSection={currentSection} onSectionChange={handleSectionChange} />;
      case 'settings':
        return <Settings currentSection={currentSection} onSectionChange={handleSectionChange} />;
      default:
        return <Dashboard currentSection={currentSection} onSectionChange={handleSectionChange} />;
    }
  };

  return (
    <MuiThemeProvider theme={theme}>
      <CssBaseline />
      {renderSection()}
    </MuiThemeProvider>
  );
};

const App: React.FC = () => {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
};

export default App;
