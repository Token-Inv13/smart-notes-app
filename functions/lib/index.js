"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanupOldReminders = exports.checkAndSendReminders = void 0;
const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();
exports.checkAndSendReminders = functions.pubsub
    .schedule('every 5 minutes')
    .onRun(async (context) => {
    const now = new Date();
    const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60000);
    try {
        const db = admin.firestore();
        const remindersSnapshot = await db
            .collection('taskReminders')
            .where('sent', '==', false)
            .where('reminderTime', '>=', now.toISOString())
            .where('reminderTime', '<=', fiveMinutesFromNow.toISOString())
            .get();
        const reminderPromises = remindersSnapshot.docs.map(async (doc) => {
            var _a, _b;
            const reminder = doc.data();
            // Get the task details
            const taskDoc = await db.collection('tasks').doc(reminder.taskId).get();
            if (!taskDoc.exists) {
                console.log(`Task ${reminder.taskId} not found, skipping reminder`);
                return;
            }
            const task = taskDoc.data();
            // Get user's FCM tokens
            const userDoc = await db.collection('users').doc(reminder.userId).get();
            if (!userDoc.exists) {
                console.log(`User ${reminder.userId} not found, skipping reminder`);
                return;
            }
            const userData = userDoc.data();
            const fcmTokens = (userData === null || userData === void 0 ? void 0 : userData.fcmTokens) || {};
            // Check if notifications are enabled
            if (!((_b = (_a = userData === null || userData === void 0 ? void 0 : userData.settings) === null || _a === void 0 ? void 0 : _a.notifications) === null || _b === void 0 ? void 0 : _b.taskReminders)) {
                console.log(`Notifications disabled for user ${reminder.userId}`);
                return;
            }
            // Prepare notification message
            const message = {
                notification: {
                    title: 'Task Due Soon',
                    body: `"${task === null || task === void 0 ? void 0 : task.title}" is due in 1 hour`
                },
                data: {
                    taskId: reminder.taskId,
                    dueDate: reminder.dueDate
                }
            };
            // Send notifications to all user's devices
            const sendPromises = Object.keys(fcmTokens).map(async (token) => {
                try {
                    await admin.messaging().send(Object.assign(Object.assign({}, message), { token }));
                }
                catch (error) {
                    const messagingError = error;
                    if (messagingError.code === 'messaging/invalid-registration-token' ||
                        messagingError.code === 'messaging/registration-token-not-registered') {
                        // Remove invalid token
                        const tokenUpdate = {
                            [`fcmTokens.${token}`]: admin.firestore.FieldValue.delete()
                        };
                        await db.collection('users').doc(reminder.userId).update(tokenUpdate);
                    }
                }
            });
            await Promise.all(sendPromises);
            // Mark reminder as sent
            await doc.ref.update({ sent: true });
        });
        await Promise.all(reminderPromises);
        console.log('Reminder check completed successfully');
    }
    catch (error) {
        console.error('Error processing reminders:', error instanceof Error ? error.message : 'Unknown error');
    }
});
// Optional: Clean up old reminders
exports.cleanupOldReminders = functions.pubsub
    .schedule('every 24 hours')
    .onRun(async (context) => {
    const db = admin.firestore();
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    try {
        const oldReminders = await db
            .collection('taskReminders')
            .where('reminderTime', '<=', twoDaysAgo.toISOString())
            .get();
        const deletePromises = oldReminders.docs.map((doc) => doc.ref.delete());
        await Promise.all(deletePromises);
        console.log(`Cleaned up ${oldReminders.size} old reminders`);
    }
    catch (error) {
        console.error('Error cleaning up old reminders:', error instanceof Error ? error.message : 'Unknown error');
    }
});
//# sourceMappingURL=index.js.map