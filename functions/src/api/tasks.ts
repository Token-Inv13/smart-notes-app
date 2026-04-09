import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import { ServerTaskCreateInput } from '../core/types';
import { toFirestoreTimestamp } from '../core/utils';
import { assertCanCreateFreeTask, assertCanFavoriteFreeTask } from '../core/guards';

export const createTaskWithPlanGuard = functions.https.onCall(async (data: ServerTaskCreateInput, context) => {
  const uid = context.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Authentification requise.');

  const db = admin.firestore();
  const taskRef = db.collection('tasks').doc();

  await db.runTransaction(async (tx) => {
    await assertCanCreateFreeTask(tx, db, uid);

    tx.create(taskRef, {
      ...data,
      userId: uid,
      startDate: toFirestoreTimestamp(data.startDateMs),
      dueDate: toFirestoreTimestamp(data.dueDateMs),
      recurrence: data.recurrence ? {
        ...data.recurrence,
        until: toFirestoreTimestamp(data.recurrence.untilMs),
      } : null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  return { id: taskRef.id };
});

export const setTaskFavoriteWithPlanGuard = functions.https.onCall(async (data: { taskId: string; favorite: boolean }, context) => {
  const uid = context.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Authentification requise.');

  const db = admin.firestore();
  const taskRef = db.collection('tasks').doc(data.taskId);

  await db.runTransaction(async (tx) => {
    if (data.favorite) {
      await assertCanFavoriteFreeTask(tx, db, uid);
    }
    tx.update(taskRef, {
      favorite: data.favorite,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  return { success: true };
});
