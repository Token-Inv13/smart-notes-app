export interface Task {
  id?: string;
  userId: string;
  title: string;
  description: string;
  dueDate: string;
  priority: 'low' | 'medium' | 'high';
  completed: boolean;
  createdAt: string;
  reminder?: {
    enabled: boolean;
    time: string;
  };
}
