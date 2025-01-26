import { useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { Snackbar, Alert } from '@mui/material';
import { RootState } from '../../store';
import { removeNotification } from '../../features/ui/uiSlice';

const Notifications = () => {
  const dispatch = useDispatch();
  const notifications = useSelector(
    (state: RootState) => state.ui.notifications
  );

  useEffect(() => {
    if (notifications.length > 0) {
      const timer = setTimeout(() => {
        dispatch(removeNotification(notifications[0].id));
      }, 6000);

      return () => clearTimeout(timer);
    }
  }, [notifications, dispatch]);

  if (notifications.length === 0) {
    return null;
  }

  const currentNotification = notifications[0];

  return (
    <Snackbar
      open={true}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
    >
      <Alert
        onClose={() => dispatch(removeNotification(currentNotification.id))}
        severity={currentNotification.type}
        sx={{ width: '100%' }}
      >
        {currentNotification.message}
      </Alert>
    </Snackbar>
  );
};

export default Notifications;
