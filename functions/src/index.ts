import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import nodemailer from 'nodemailer';

admin.initializeApp();

interface TaskReminder {
  userId: string;
  taskId: string;
  dueDate: string;
  reminderTime: string;
  sent: boolean;
  deliveryChannel?: 'web_push' | 'email';
}

interface MessagingError {
  code: string;
  [key: string]: any;
}

type SmtpEnv = {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  appBaseUrl: string;
};

function getSmtpEnv(): SmtpEnv | null {
  const cfg = functions.config() as any;

  const host = (cfg?.smtp?.host as string | undefined) ?? process.env.SMTP_HOST;
  const portRaw = (cfg?.smtp?.port as string | undefined) ?? process.env.SMTP_PORT;
  const user = (cfg?.smtp?.user as string | undefined) ?? process.env.SMTP_USER;
  const pass = (cfg?.smtp?.pass as string | undefined) ?? process.env.SMTP_PASS;
  const from = (cfg?.smtp?.from as string | undefined) ?? process.env.SMTP_FROM;
  const appBaseUrl = (cfg?.app?.base_url as string | undefined) ?? process.env.APP_BASE_URL;

  if (!host || !portRaw || !user || !pass || !from || !appBaseUrl) {
    return null;
  }

  const port = Number(portRaw);
  if (!Number.isFinite(port)) return null;

  return { host, port, user, pass, from, appBaseUrl };
}

async function sendReminderEmail(params: {
  to: string;
  taskTitle: string;
  reminderTimeIso: string;
  taskId: string;
}): Promise<void> {
  const env = getSmtpEnv();
  if (!env) {
    throw new Error('SMTP env is not configured');
  }

  const transporter = nodemailer.createTransport({
    host: env.host,
    port: env.port,
    secure: env.port === 465,
    auth: {
      user: env.user,
      pass: env.pass,
    },
  });

  const taskUrl = `${env.appBaseUrl.replace(/\/$/, '')}/tasks/${encodeURIComponent(params.taskId)}`;
  const reminderDate = new Date(params.reminderTimeIso);
  const reminderText = Number.isNaN(reminderDate.getTime())
    ? params.reminderTimeIso
    : reminderDate.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });

  const subject = '⏰ Rappel de tâche — Smart Notes';
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111;">
      <h2 style="margin: 0 0 12px;">⏰ Rappel de tâche</h2>
      <p style="margin: 0 0 8px;"><strong>${escapeHtml(params.taskTitle || 'Tâche')}</strong></p>
      <p style="margin: 0 0 16px;">Rappel : ${escapeHtml(reminderText)}</p>
      <p style="margin: 0 0 16px;">
        <a href="${taskUrl}" style="display: inline-block; padding: 10px 14px; background: #111; color: #fff; text-decoration: none; border-radius: 8px;">Ouvrir la tâche</a>
      </p>
      <p style="margin: 0; color: #555; font-size: 12px;">Smart Notes — ${escapeHtml(env.appBaseUrl)}</p>
    </div>
  `;

  await transporter.sendMail({
    from: env.from,
    to: params.to,
    subject,
    html,
  });
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export const checkAndSendReminders = functions.pubsub
  .schedule('every 1 minutes')
  .onRun(async (context) => {
    const now = new Date();
    const nowIso = now.toISOString();

    try {
      const db = admin.firestore();
      const remindersSnapshot = await db
        .collection('taskReminders')
        .where('sent', '==', false)
        .where('reminderTime', '<=', nowIso)
        .orderBy('reminderTime', 'asc')
        .limit(200)
        .get();

      console.log(
        `checkAndSendReminders: now=${nowIso} reminders=${remindersSnapshot.size}`,
      );

      const reminderPromises = remindersSnapshot.docs.map(async (doc) => {
        const reminder = doc.data() as TaskReminder;
        
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
        const fcmTokens = userData?.fcmTokens || {};

        const tokens = Object.keys(fcmTokens);

        const pushEnabled = !!userData?.settings?.notifications?.taskReminders;
        const userEmail = typeof userData?.email === 'string' ? userData.email : null;

        // Prepare notification message
        const message = {
          notification: {
            title: '⏰ Rappel de tâche',
            body: task?.title ? String(task.title) : 'Tu as une tâche à vérifier.'
          },
          data: {
            taskId: reminder.taskId,
            dueDate: reminder.dueDate,
            url: `/tasks/${reminder.taskId}`
          }
        };

        let delivered = false;
        let deliveryChannel: TaskReminder['deliveryChannel'] | undefined;

        if (pushEnabled && tokens.length > 0) {
          const invalidTokens = new Set<string>();
          let sentAny = false;

          const sendPromises = tokens.map(async (token) => {
            try {
              await admin.messaging().send({
                ...message,
                token,
              });
              sentAny = true;
            } catch (error) {
              const messagingError = error as MessagingError;
              console.warn(
                `Failed sending reminder ${doc.id} to token (user=${reminder.userId}) code=${messagingError.code}`,
              );
              if (
                messagingError.code === 'messaging/invalid-registration-token' ||
                messagingError.code === 'messaging/registration-token-not-registered'
              ) {
                invalidTokens.add(token);
              }
            }
          });

          await Promise.all(sendPromises);

          if (invalidTokens.size > 0) {
            try {
              const nextMap: Record<string, boolean> = {};
              for (const t of tokens) {
                if (!invalidTokens.has(t)) nextMap[t] = true;
              }
              await db.collection('users').doc(reminder.userId).update({ fcmTokens: nextMap });
            } catch (e) {
              console.warn(`Failed cleaning invalid tokens for user ${reminder.userId}`, e);
            }
          }

          if (sentAny) {
            delivered = true;
            deliveryChannel = 'web_push';
          }
        }

        if (!delivered) {
          if (!userEmail) {
            console.warn(`No email available for user ${reminder.userId}; cannot send email reminder ${doc.id}`);
          } else {
            try {
              await sendReminderEmail({
                to: userEmail,
                taskTitle: task?.title ? String(task.title) : 'Tâche',
                reminderTimeIso: reminder.reminderTime,
                taskId: reminder.taskId,
              });
              delivered = true;
              deliveryChannel = 'email';
            } catch (e) {
              console.error(`Email reminder failed for ${doc.id} (user=${reminder.userId})`, e);
            }
          }
        }

        if (delivered) {
          await doc.ref.update({ sent: true, deliveryChannel });
        }
      });
      
      await Promise.all(reminderPromises);
      
      console.log('Reminder check completed successfully');
    } catch (error) {
      console.error('Error processing reminders:', error instanceof Error ? error.message : 'Unknown error');
    }
  });

// Optional: Clean up old reminders
export const cleanupOldReminders = functions.pubsub
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
    } catch (error) {
      console.error('Error cleaning up old reminders:', error instanceof Error ? error.message : 'Unknown error');
    }
  });
