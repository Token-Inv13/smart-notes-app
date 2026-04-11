import * as functions from 'firebase-functions/v1';
import { 
  FREE_NOTE_LIMIT, 
  FREE_ACTIVE_TASK_LIMIT, 
  FREE_FAVORITE_NOTES_LIMIT, 
  FREE_FAVORITE_TASKS_LIMIT,
  FREE_NOTE_LIMIT_MESSAGE,
  FREE_TASK_LIMIT_MESSAGE
} from './types';
import { getUserPlanInTransaction } from './utils';

export async function assertCanCreateFreeNote(
  tx: FirebaseFirestore.Transaction,
  db: FirebaseFirestore.Firestore,
  userId: string,
) {
  const userPlan = await getUserPlanInTransaction(tx, db, userId);
  if (userPlan === 'pro') return;

  const notesSnap = await tx.get(
    db.collection('notes').where('userId', '==', userId).limit(FREE_NOTE_LIMIT),
  );
  if (notesSnap.size >= FREE_NOTE_LIMIT) {
    throw new functions.https.HttpsError('resource-exhausted', FREE_NOTE_LIMIT_MESSAGE);
  }
}

export async function assertCanFavoriteFreeNote(
  tx: FirebaseFirestore.Transaction,
  db: FirebaseFirestore.Firestore,
  userId: string,
) {
  const userPlan = await getUserPlanInTransaction(tx, db, userId);
  if (userPlan === 'pro') return;

  const favoritesSnap = await tx.get(
    db.collection('notes').where('userId', '==', userId).where('favorite', '==', true).limit(FREE_FAVORITE_NOTES_LIMIT),
  );
  if (favoritesSnap.size >= FREE_FAVORITE_NOTES_LIMIT) {
    throw new functions.https.HttpsError('resource-exhausted', FREE_NOTE_LIMIT_MESSAGE);
  }
}

export async function assertCanCreateFreeTask(
  tx: FirebaseFirestore.Transaction,
  db: FirebaseFirestore.Firestore,
  userId: string,
) {
  const userPlan = await getUserPlanInTransaction(tx, db, userId);
  if (userPlan === 'pro') return;

  const tasksSnap = await tx.get(
    db.collection('tasks').where('userId', '==', userId).where('archived', '==', false).limit(FREE_ACTIVE_TASK_LIMIT),
  );
  if (tasksSnap.size >= FREE_ACTIVE_TASK_LIMIT) {
    throw new functions.https.HttpsError('resource-exhausted', FREE_TASK_LIMIT_MESSAGE);
  }
}

export async function assertCanCreateMultipleFreeTasks(
  tx: FirebaseFirestore.Transaction,
  db: FirebaseFirestore.Firestore,
  userId: string,
  countToCreate: number,
) {
  if (countToCreate <= 0) return;
  const userPlan = await getUserPlanInTransaction(tx, db, userId);
  if (userPlan === 'pro') return;

  const tasksSnap = await tx.get(
    db.collection('tasks').where('userId', '==', userId).where('archived', '==', false).limit(FREE_ACTIVE_TASK_LIMIT),
  );
  if (tasksSnap.size + countToCreate > FREE_ACTIVE_TASK_LIMIT) {
    throw new functions.https.HttpsError('resource-exhausted', FREE_TASK_LIMIT_MESSAGE);
  }
}

export async function assertCanFavoriteFreeTask(
  tx: FirebaseFirestore.Transaction,
  db: FirebaseFirestore.Firestore,
  userId: string,
) {
  const userPlan = await getUserPlanInTransaction(tx, db, userId);
  if (userPlan === 'pro') return;

  const favoritesSnap = await tx.get(
    db
      .collection('tasks')
      .where('userId', '==', userId)
      .where('favorite', '==', true)
      .where('archived', '==', false)
      .limit(FREE_FAVORITE_TASKS_LIMIT),
  );
  if (favoritesSnap.size >= FREE_FAVORITE_TASKS_LIMIT) {
    throw new functions.https.HttpsError('resource-exhausted', FREE_TASK_LIMIT_MESSAGE);
  }
}
