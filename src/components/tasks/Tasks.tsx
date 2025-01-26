import React, { useState, useEffect, useCallback } from 'react';
import { auth, db } from '../../services/firebase';
import {
  collection,
  addDoc,
  query,
  getDocs,
  where,
  updateDoc,
  doc,
  deleteDoc
} from 'firebase/firestore';
import {
  Container,
  Card,
  Typography,
  TextField,
  Button,
  Alert,
  Fade,
  Box,
  Checkbox,
  IconButton,
  CircularProgress,
  Grid,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  Chip,
} from '@mui/material';
import {
  Delete as DeleteIcon,
  Edit as EditIcon,
  Add as AddIcon,
  Sort as SortIcon,
  Search as SearchIcon,
  AccessTime as TimeIcon,
  Flag as FlagIcon,
  CheckCircle as CheckCircleIcon,
  RadioButtonUnchecked as UncheckedIcon,
} from '@mui/icons-material';
import Layout from '../layout/Layout';
import TaskForm from './TaskForm';
import { Task, Priority } from './types';
import { format } from 'date-fns';

interface TasksProps {
  currentSection: string;
  onSectionChange: (section: string) => void;
}

type SortOption = 'dueDate' | 'priority' | 'createdAt';

const Tasks: React.FC<TasksProps> = ({ currentSection, onSectionChange }) => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error' | 'info'>('info');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('dueDate');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | undefined>();

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      // Check if date is valid
      if (isNaN(date.getTime())) {
        return 'Invalid date';
      }
      return format(date, 'MMM d, yyyy');
    } catch (error) {
      console.error('Error formatting date:', error);
      return 'Invalid date';
    }
  };

  const showMessage = (text: string, type: 'success' | 'error' | 'info') => {
    setMessage(text);
    setMessageType(type);
  };

  const loadTasks = useCallback(async () => {
    if (!auth.currentUser) return;
    setLoading(true);

    try {
      const q = query(
        collection(db, 'tasks'),
        where('userId', '==', auth.currentUser.uid)
      );

      const querySnapshot = await getDocs(q);
      let tasksList = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Task[];

      // Sort tasks client-side
      tasksList = tasksList.sort((a, b) => {
        try {
          switch (sortBy) {
            case 'dueDate': {
              const dateA = new Date(a.dueDate).getTime();
              const dateB = new Date(b.dueDate).getTime();
              if (isNaN(dateA) || isNaN(dateB)) return 0;
              return dateA - dateB;
            }
            case 'priority': {
              const priorityWeight = { low: 0, medium: 1, high: 2 };
              return priorityWeight[b.priority] - priorityWeight[a.priority];
            }
            case 'createdAt': {
              const dateA = new Date(a.createdAt).getTime();
              const dateB = new Date(b.createdAt).getTime();
              if (isNaN(dateA) || isNaN(dateB)) return 0;
              return dateB - dateA;
            }
            default:
              return 0;
          }
        } catch (error) {
          console.error('Error sorting tasks:', error);
          return 0;
        }
      });

      setTasks(tasksList);
    } catch (error) {
      const err = error as Error;
      showMessage(`Error loading tasks: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [sortBy]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  const handleCreateTask = async (taskData: Omit<Task, 'id' | 'userId' | 'completed'>) => {
    if (!auth.currentUser) {
      showMessage('Please sign in first', 'error');
      return;
    }

    try {
      setLoading(true);
      await addDoc(collection(db, 'tasks'), {
        ...taskData,
        completed: false,
        userId: auth.currentUser.uid,
      });
      showMessage('Task created successfully', 'success');
      loadTasks();
    } catch (error) {
      const err = error as Error;
      showMessage(`Error creating task: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateTask = async (taskId: string, updates: Partial<Task>) => {
    try {
      await updateDoc(doc(db, 'tasks', taskId), updates);
      showMessage('Task updated successfully', 'success');
      loadTasks();
    } catch (error) {
      const err = error as Error;
      showMessage(`Error updating task: ${err.message}`, 'error');
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    try {
      await deleteDoc(doc(db, 'tasks', taskId));
      showMessage('Task deleted successfully', 'success');
      loadTasks();
    } catch (error) {
      const err = error as Error;
      showMessage(`Error deleting task: ${err.message}`, 'error');
    }
  };

  const filteredTasks = tasks.filter(task =>
    task.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    task.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getPriorityColor = (priority: Priority) => {
    switch (priority) {
      case 'high':
        return 'error';
      case 'medium':
        return 'warning';
      case 'low':
        return 'success';
      default:
        return 'default';
    }
  };

  const getStatusChip = (completed: boolean) => {
    if (completed) {
      return (
        <Chip
          size="small"
          icon={<CheckCircleIcon sx={{ fontSize: 16 }} />}
          label="Completed"
          sx={{
            bgcolor: 'success.light',
            color: 'success.dark',
            '& .MuiChip-icon': {
              color: 'success.dark',
            },
          }}
        />
      );
    }
    return (
      <Chip
        size="small"
        icon={<UncheckedIcon sx={{ fontSize: 16 }} />}
        label="In Progress"
        sx={{
          bgcolor: 'info.light',
          color: 'info.dark',
          '& .MuiChip-icon': {
            color: 'info.dark',
          },
        }}
      />
    );
  };

  return (
    <Layout currentSection={currentSection} onSectionChange={onSectionChange}>
      <Container maxWidth="md">
        <Card
          elevation={0}
          sx={{
            p: 3,
            bgcolor: 'white',
            borderRadius: 2
          }}
        >
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
            <Typography variant="h6">
              Tasks
            </Typography>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setIsFormOpen(true)}
            >
              New Task
            </Button>
          </Box>

          <Fade in={!!message}>
            <Alert 
              severity={messageType}
              sx={{ mb: 3 }}
            >
              {message}
            </Alert>
          </Fade>

          <Box sx={{ display: 'flex', gap: 2, mb: 4 }}>
            <TextField
              size="small"
              placeholder="Search tasks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              fullWidth
              InputProps={{
                startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} />,
              }}
            />
            <FormControl size="small" sx={{ minWidth: 120 }}>
              <InputLabel>Sort By</InputLabel>
              <Select
                value={sortBy}
                label="Sort By"
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                startAdornment={<SortIcon sx={{ mr: 1, color: 'text.secondary' }} />}
              >
                <MenuItem value="dueDate">Due Date</MenuItem>
                <MenuItem value="priority">Priority</MenuItem>
                <MenuItem value="createdAt">Created</MenuItem>
              </Select>
            </FormControl>
          </Box>

          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
              <CircularProgress size={24} />
            </Box>
          ) : filteredTasks.length > 0 ? (
            <Grid container spacing={2}>
              {filteredTasks.map((task) => (
                <Grid item xs={12} key={task.id}>
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      p: 2,
                      bgcolor: 'background.paper',
                      borderRadius: 2,
                      gap: 2,
                      boxShadow: '0px 2px 4px rgba(0, 0, 0, 0.05)',
                      '&:hover': {
                        bgcolor: '#f8f9fa',
                      },
                      mb: 2,
                      opacity: task.completed ? 0.8 : 1,
                      transition: 'all 0.2s ease-in-out',
                    }}
                  >
                    <Checkbox
                      checked={task.completed}
                      onChange={() => handleUpdateTask(task.id, { completed: !task.completed })}
                      icon={<UncheckedIcon />}
                      checkedIcon={<CheckCircleIcon />}
                      sx={{
                        '&.Mui-checked': {
                          color: 'success.main',
                        },
                        transition: 'all 0.2s ease-in-out',
                      }}
                    />
                    <Box sx={{ flex: 1 }}>
                      <Typography
                        variant="body1"
                        sx={{
                          textDecoration: task.completed ? 'line-through' : 'none',
                          color: task.completed ? 'text.secondary' : 'text.primary',
                          fontWeight: 500,
                          mb: 0.5,
                          transition: 'all 0.2s ease-in-out',
                        }}
                      >
                        {task.title}
                      </Typography>
                      {task.description && (
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{
                            mb: 1,
                            textDecoration: task.completed ? 'line-through' : 'none',
                            transition: 'all 0.2s ease-in-out',
                          }}
                        >
                          {task.description}
                        </Typography>
                      )}
                      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                        {getStatusChip(task.completed)}
                        <Chip
                          size="small"
                          icon={<TimeIcon sx={{ fontSize: 16 }} />}
                          label={formatDate(task.dueDate)}
                          sx={{
                            bgcolor: 'background.default',
                            '& .MuiChip-label': {
                              px: 1,
                            },
                          }}
                        />
                        <Chip
                          size="small"
                          icon={<FlagIcon sx={{ fontSize: 16 }} />}
                          label={task.priority}
                          color={getPriorityColor(task.priority)}
                          sx={{
                            '& .MuiChip-label': {
                              px: 1,
                            },
                          }}
                        />
                      </Box>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <IconButton
                        size="small"
                        onClick={() => {
                          setEditingTask(task);
                          setIsFormOpen(true);
                        }}
                        sx={{
                          color: 'text.secondary',
                          '&:hover': {
                            color: 'primary.main',
                            bgcolor: 'primary.light',
                            opacity: 0.1,
                          },
                        }}
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <IconButton
                        size="small"
                        onClick={() => handleDeleteTask(task.id)}
                        sx={{
                          color: 'error.main',
                          '&:hover': {
                            bgcolor: 'error.light',
                            opacity: 0.1,
                          },
                        }}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  </Box>
                </Grid>
              ))}
            </Grid>
          ) : (
            <Box
              sx={{
                p: 4,
                textAlign: 'center',
                bgcolor: '#f8f9fa',
                borderRadius: 2
              }}
            >
              <Typography variant="body1" color="text.secondary">
                {searchQuery
                  ? 'No tasks found matching your search.'
                  : 'No tasks yet. Create your first task above!'}
              </Typography>
            </Box>
          )}
        </Card>
      </Container>

      <TaskForm
        open={isFormOpen}
        onClose={() => {
          setIsFormOpen(false);
          setEditingTask(undefined);
        }}
        onSubmit={editingTask
          ? (updates) => handleUpdateTask(editingTask.id, updates)
          : handleCreateTask}
        editTask={editingTask}
      />
    </Layout>
  );
};

export default Tasks;
