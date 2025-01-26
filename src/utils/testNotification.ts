import { addDoc, collection } from 'firebase/firestore';
import { db } from '../services/firebase';
import { NotificationService } from '../services/notificationService';

export const createTestTask = async (userId: string) => {
  try {
    // Créer une tâche qui arrive à échéance dans 65 minutes (pour avoir la notification dans ~5 minutes)
    const dueDate = new Date();
    dueDate.setMinutes(dueDate.getMinutes() + 65);

    // Ajouter la tâche
    const taskRef = await addDoc(collection(db, 'tasks'), {
      userId,
      title: 'Tâche test de notification',
      description: 'Cette tâche est créée pour tester le système de notifications.',
      dueDate: dueDate.toISOString(),
      priority: 'medium',
      completed: false,
      createdAt: new Date().toISOString()
    });

    // Programmer le rappel
    await NotificationService.scheduleTaskReminder(userId, taskRef.id, dueDate);

    console.log('Tâche test créée avec succès. ID:', taskRef.id);
    console.log('Vous devriez recevoir une notification dans environ 5 minutes.');
    
    return taskRef.id;
  } catch (error) {
    console.error('Erreur lors de la création de la tâche test:', error);
    throw error;
  }
};
