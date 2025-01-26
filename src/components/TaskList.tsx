import React, { useEffect, useState } from 'react';
import {
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  IconButton,
  Typography,
  Paper,
  Chip,
  Box,
  useTheme,
  Tooltip,
  Divider
} from '@mui/material';
import {
  AccessTime as AccessTimeIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Notifications as NotificationsIcon,
  CheckCircle as CheckCircleIcon,
  RadioButtonUnchecked as RadioButtonUncheckedIcon,
  Flag as FlagIcon
} from '@mui/icons-material';
import { collection, query, where, onSnapshot, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useAuth } from '../hooks/useAuth';
import { Task } from '../types/task';
import { format, isToday, isTomorrow, isPast } from 'date-fns';

interface TaskListProps {
  onEditTask: (taskId: string) => void;
}

export const TaskList: React.FC<TaskListProps> = ({ onEditTask }) => {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const theme = useTheme();

  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'tasks'),
      where('userId', '==', user.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const taskList: Task[] = [];
      snapshot.forEach((doc) => {
        taskList.push({ id: doc.id, ...doc.data() } as Task);
      });
      
      // Sort tasks: incomplete first, then by due date
      taskList.sort((a, b) => {
        if (a.completed !== b.completed) {
          return a.completed ? 1 : -1;
        }
        return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      });
      
      setTasks(taskList);
    });

    return () => unsubscribe();
  }, [user]);

  const handleDelete = async (taskId: string) => {
    try {
      await deleteDoc(doc(db, 'tasks', taskId));
    } catch (error) {
      console.error('Error deleting task:', error);
    }
  };

  const handleToggleComplete = async (task: Task) => {
    if (!task.id) return;
    
    try {
      await updateDoc(doc(db, 'tasks', task.id), {
        completed: !task.completed
      });
    } catch (error) {
      console.error('Error updating task:', error);
    }
  };

  const getPriorityColor = (priority: Task['priority']) => {
    switch (priority) {
      case 'high':
        return theme.palette.error.main;
      case 'medium':
        return theme.palette.warning.main;
      case 'low':
        return theme.palette.success.main;
      default:
        return theme.palette.text.secondary;
    }
  };

  const getPriorityIcon = (priority: Task['priority']) => {
    return (
      <FlagIcon
        sx={{
          color: getPriorityColor(priority),
          fontSize: '1rem',
          verticalAlign: 'middle'
        }}
      />
    );
  };

  const formatDueDate = (date: string) => {
    const dueDate = new Date(date);
    if (isToday(dueDate)) {
      return 'Today';
    } else if (isTomorrow(dueDate)) {
      return 'Tomorrow';
    } else {
      return format(dueDate, 'PPP');
    }
  };

  const formatTime = (date: string) => {
    return format(new Date(date), 'p');
  };

  const getDueDateColor = (date: string) => {
    const dueDate = new Date(date);
    if (isPast(dueDate) && !isToday(dueDate)) {
      return theme.palette.error.main;
    }
    return theme.palette.text.secondary;
  };

  return (
    <Paper sx={{ mt: 2, bgcolor: 'background.paper' }}>
      <List sx={{ p: 0 }}>
        {tasks.map((task, index) => (
          <React.Fragment key={task.id}>
            {index > 0 && <Divider />}
            <ListItem
              sx={{
                opacity: task.completed ? 0.7 : 1,
                bgcolor: task.completed ? 'action.hover' : 'background.paper',
                transition: 'all 0.2s ease',
                '&:hover': {
                  bgcolor: 'action.hover'
                }
              }}
              secondaryAction={
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Tooltip title="Edit task">
                    <IconButton
                      edge="end"
                      aria-label="edit"
                      onClick={() => onEditTask(task.id!)}
                      size="small"
                    >
                      <EditIcon />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Delete task">
                    <IconButton
                      edge="end"
                      aria-label="delete"
                      onClick={() => handleDelete(task.id!)}
                      size="small"
                    >
                      <DeleteIcon />
                    </IconButton>
                  </Tooltip>
                </Box>
              }
            >
              <ListItemIcon 
                onClick={() => handleToggleComplete(task)} 
                sx={{ 
                  cursor: 'pointer',
                  minWidth: 40
                }}
              >
                <Tooltip title={task.completed ? "Mark as incomplete" : "Mark as complete"}>
                  {task.completed ? (
                    <CheckCircleIcon color="success" />
                  ) : (
                    <RadioButtonUncheckedIcon />
                  )}
                </Tooltip>
              </ListItemIcon>
              <ListItemText
                primary={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                    <Typography
                      variant="body1"
                      sx={{
                        textDecoration: task.completed ? 'line-through' : 'none',
                        fontWeight: task.completed ? 'normal' : 500
                      }}
                    >
                      {task.title}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexWrap: 'wrap' }}>
                      <Tooltip title={`Priority: ${task.priority}`}>
                        <Chip
                          size="small"
                          icon={getPriorityIcon(task.priority)}
                          label={task.priority}
                          sx={{
                            color: getPriorityColor(task.priority),
                            borderColor: getPriorityColor(task.priority),
                            bgcolor: 'transparent',
                            height: 24
                          }}
                          variant="outlined"
                        />
                      </Tooltip>
                      {task.reminder?.enabled && (
                        <Tooltip title={`Reminder set for ${format(new Date(task.reminder.time), 'PPp')}`}>
                          <Chip
                            size="small"
                            icon={<NotificationsIcon sx={{ fontSize: '1rem' }} />}
                            label={format(new Date(task.reminder.time), 'p')}
                            color="primary"
                            variant="outlined"
                            sx={{ height: 24 }}
                          />
                        </Tooltip>
                      )}
                    </Box>
                  </Box>
                }
                secondary={
                  <Box sx={{ mt: 0.5 }}>
                    {task.description && (
                      <Typography 
                        variant="body2" 
                        color="text.secondary"
                        sx={{ 
                          mb: 0.5,
                          textDecoration: task.completed ? 'line-through' : 'none'
                        }}
                      >
                        {task.description}
                      </Typography>
                    )}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <AccessTimeIcon 
                        fontSize="small" 
                        sx={{ 
                          color: getDueDateColor(task.dueDate),
                          fontSize: '1rem'
                        }} 
                      />
                      <Typography 
                        variant="caption" 
                        sx={{ 
                          color: getDueDateColor(task.dueDate)
                        }}
                      >
                        Due: {formatDueDate(task.dueDate)} at {formatTime(task.dueDate)}
                      </Typography>
                    </Box>
                  </Box>
                }
              />
            </ListItem>
          </React.Fragment>
        ))}
        {tasks.length === 0 && (
          <ListItem>
            <ListItemText
              primary={
                <Typography 
                  variant="body1" 
                  color="text.secondary" 
                  align="center"
                  sx={{ py: 4 }}
                >
                  No tasks yet. Click the "New Task" button to create one!
                </Typography>
              }
            />
          </ListItem>
        )}
      </List>
    </Paper>
  );
};
