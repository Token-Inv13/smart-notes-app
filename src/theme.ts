import { createTheme, alpha } from '@mui/material';

export const createAppTheme = (darkMode: boolean) => {
  // Base colors with improved contrast ratios
  const primaryColor = darkMode ? '#4dabf5' : '#2196f3'; // Lighter in dark mode
  const backgroundColor = darkMode ? '#121212' : '#f5f5f5';
  const surfaceColor = darkMode ? '#1e1e1e' : '#ffffff';
  const cardBackgroundColor = darkMode ? '#2a2a2a' : '#ffffff'; // Slightly lighter for cards
  const cardHoverColor = darkMode ? '#323232' : '#fafafa';

  // Text colors
  const textPrimary = darkMode ? '#ffffff' : '#212121'; // Pure white for better contrast
  const textSecondary = darkMode ? '#b3b3b3' : '#757575'; // Lighter gray
  const iconColor = darkMode ? '#e0e0e0' : '#616161'; // More visible icons

  // Status colors
  const errorColor = darkMode ? '#ff5252' : '#d32f2f'; // More visible red
  const successColor = darkMode ? '#69f0ae' : '#2e7d32'; // More visible green

  // Overlay colors
  const hoverOverlayLight = 'rgba(255, 255, 255, 0.08)';
  const hoverOverlayDark = 'rgba(0, 0, 0, 0.04)';

  return createTheme({
    palette: {
      mode: darkMode ? 'dark' : 'light',
      primary: {
        main: primaryColor,
        light: darkMode ? '#64b5f6' : '#64b5f6',
        dark: darkMode ? '#1976d2' : '#1976d2',
      },
      error: {
        main: errorColor,
      },
      success: {
        main: successColor,
      },
      background: {
        default: backgroundColor,
        paper: surfaceColor,
      },
      text: {
        primary: textPrimary,
        secondary: textSecondary,
      },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            backgroundColor,
            transition: 'all 0.2s ease-in-out',
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            backgroundColor: cardBackgroundColor,
            color: textPrimary,
            boxShadow: darkMode 
              ? '0 4px 6px rgba(0,0,0,0.4)'
              : '0 1px 3px rgba(0,0,0,0.12)',
            borderRadius: '12px',
            border: darkMode ? '1px solid rgba(255,255,255,0.08)' : 'none',
            transition: 'all 0.2s ease-in-out',
            '&:hover': {
              backgroundColor: cardHoverColor,
              transform: 'translateY(-2px)',
              boxShadow: darkMode 
                ? '0 6px 12px rgba(0,0,0,0.5)'
                : '0 4px 8px rgba(0,0,0,0.1)',
            },
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            textTransform: 'none',
            borderRadius: '8px',
            fontWeight: 500,
            transition: 'all 0.2s ease-in-out',
          },
          contained: {
            backgroundColor: primaryColor,
            color: darkMode ? '#000000' : '#ffffff',
            '&:hover': {
              backgroundColor: darkMode ? '#64b5f6' : '#1976d2',
            },
            '&.Mui-disabled': {
              backgroundColor: darkMode ? alpha('#424242', 0.7) : alpha('#e0e0e0', 0.7),
              color: darkMode ? alpha('#ffffff', 0.3) : alpha('#000000', 0.3),
            },
          },
          text: {
            color: primaryColor,
            '&:hover': {
              backgroundColor: darkMode ? alpha(primaryColor, 0.12) : alpha(primaryColor, 0.08),
              color: primaryColor,
            },
          },
          outlined: {
            borderColor: darkMode ? alpha(primaryColor, 0.5) : primaryColor,
            color: primaryColor,
            '&:hover': {
              backgroundColor: darkMode ? alpha(primaryColor, 0.12) : alpha(primaryColor, 0.08),
              borderColor: primaryColor,
            },
          },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: {
            color: iconColor,
            transition: 'all 0.2s ease-in-out',
            '&:hover': {
              backgroundColor: darkMode ? hoverOverlayLight : hoverOverlayDark,
              color: darkMode ? '#ffffff' : primaryColor,
            },
            '&.Mui-disabled': {
              color: darkMode ? alpha('#ffffff', 0.3) : alpha('#000000', 0.3),
            },
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundColor: cardBackgroundColor,
            color: textPrimary,
            transition: 'all 0.2s ease-in-out',
            '&.MuiCard-root': {
              backgroundColor: cardBackgroundColor,
            },
          },
        },
      },
      MuiListItemText: {
        styleOverrides: {
          primary: {
            color: textPrimary,
          },
          secondary: {
            color: textSecondary,
          },
        },
      },
      MuiListItemIcon: {
        styleOverrides: {
          root: {
            color: iconColor,
            minWidth: '40px',
          },
        },
      },
      MuiListItem: {
        styleOverrides: {
          root: {
            borderRadius: '8px',
            margin: '4px 0',
            transition: 'all 0.2s ease-in-out',
            color: textPrimary,
            '&:hover': {
              backgroundColor: darkMode ? alpha(primaryColor, 0.08) : alpha(primaryColor, 0.04),
              color: textPrimary,
            },
            '&.Mui-selected': {
              backgroundColor: darkMode ? alpha(primaryColor, 0.15) : alpha(primaryColor, 0.08),
              color: textPrimary,
              '&:hover': {
                backgroundColor: darkMode ? alpha(primaryColor, 0.25) : alpha(primaryColor, 0.12),
                color: textPrimary,
              },
            },
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            backgroundColor: darkMode ? alpha(primaryColor, 0.15) : alpha(primaryColor, 0.08),
            color: darkMode ? textPrimary : primaryColor,
            transition: 'all 0.2s ease-in-out',
            '&:hover': {
              backgroundColor: darkMode ? alpha(primaryColor, 0.25) : alpha(primaryColor, 0.12),
              color: darkMode ? textPrimary : primaryColor,
            },
            '&.MuiChip-clickable:hover': {
              backgroundColor: darkMode ? alpha(primaryColor, 0.25) : alpha(primaryColor, 0.12),
              color: darkMode ? textPrimary : primaryColor,
            },
          },
          deleteIcon: {
            color: 'inherit',
            '&:hover': {
              color: darkMode ? errorColor : alpha(errorColor, 0.7),
            },
          },
          label: {
            color: 'inherit',
          },
        },
      },
      MuiSwitch: {
        styleOverrides: {
          root: {
            width: 42,
            height: 26,
            padding: 0,
          },
          switchBase: {
            padding: 1,
            '&.Mui-checked': {
              transform: 'translateX(16px)',
              color: '#fff',
              '& + .MuiSwitch-track': {
                backgroundColor: primaryColor,
                opacity: 1,
              },
            },
          },
          thumb: {
            width: 24,
            height: 24,
          },
          track: {
            borderRadius: 13,
            backgroundColor: darkMode ? '#666' : '#999',
          },
        },
      },
      MuiDivider: {
        styleOverrides: {
          root: {
            borderColor: darkMode 
              ? 'rgba(255,255,255,0.08)'
              : 'rgba(0,0,0,0.08)',
          },
        },
      },
      MuiTextField: {
        styleOverrides: {
          root: {
            '& .MuiOutlinedInput-root': {
              backgroundColor: darkMode 
                ? alpha('#323232', 0.9)
                : alpha('#ffffff', 0.9),
              backdropFilter: 'blur(8px)',
              borderRadius: '10px',
              '& fieldset': {
                borderColor: darkMode 
                  ? 'rgba(255,255,255,0.15)'
                  : 'rgba(0,0,0,0.23)',
                borderWidth: '1px',
              },
              '&:hover fieldset': {
                borderColor: darkMode 
                  ? 'rgba(255,255,255,0.3)'
                  : 'rgba(0,0,0,0.87)',
              },
              '&.Mui-focused fieldset': {
                borderColor: primaryColor,
                borderWidth: '2px',
              },
            },
            '& .MuiInputLabel-root': {
              color: textSecondary,
              '&.Mui-focused': {
                color: primaryColor,
              },
            },
            '& .MuiInputBase-input': {
              color: textPrimary,
              '&::placeholder': {
                color: textSecondary,
                opacity: 0.7,
              },
            },
          },
        },
      },
    },
  });
};
