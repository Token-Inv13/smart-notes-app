import * as nodemailer from 'nodemailer';
import { readEnvString } from './telemetry';

export type SmtpEnv = {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  appBaseUrl: string;
};

export type SmtpEnvResolved = {
  env: SmtpEnv;
  source: 'env' | 'hardcoded';
};

export function getSmtpEnv(): SmtpEnvResolved | null {
  const source: 'env' | 'hardcoded' = 'env';
  const host = readEnvString('SMTP_HOST');
  const portRaw = readEnvString('SMTP_PORT');
  const user = readEnvString('SMTP_USER');
  const pass = readEnvString('SMTP_PASS');
  const from = readEnvString('SMTP_FROM');
  const appBaseUrl = readEnvString('APP_BASE_URL') || 'https://tasknote.io';

  if (!host || !portRaw || !user || !pass || !from) {
    return null;
  }

  const port = Number(portRaw);
  if (!Number.isFinite(port)) {
    return null;
  }

  return { env: { host, port, user, pass, from, appBaseUrl }, source };
}

export function createSmtpTransport(env: SmtpEnv) {
  return nodemailer.createTransport({
    host: env.host,
    port: env.port,
    secure: env.port === 465,
    requireTLS: env.port === 587,
    tls: {
      minVersion: 'TLSv1.2',
    },
    auth: {
      user: env.user,
      pass: env.pass,
    },
  });
}

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export async function sendReminderEmail(params: {
  to: string;
  taskTitle: string;
  reminderText: string;
  taskUrl: string;
  appBaseUrl: string;
}): Promise<void> {
  const resolved = getSmtpEnv();
  if (!resolved) throw new Error('SMTP env is not configured');

  const { env } = resolved;
  const transporter = createSmtpTransport(env);

  const subject = '⏰ Rappel de tâche — TaskNote';
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111;">
      <h2 style="margin: 0 0 12px;">⏰ Rappel de tâche</h2>
      <p style="margin: 0 0 8px;"><strong>${escapeHtml(params.taskTitle || 'Tâche')}</strong></p>
      <p style="margin: 0 0 16px;">Rappel : ${escapeHtml(params.reminderText)}</p>
      <p style="margin: 0 0 16px;">
        <a href="${params.taskUrl}" style="display: inline-block; padding: 10px 14px; background: #111; color: #fff; text-decoration: none; border-radius: 8px;">Ouvrir la tâche</a>
      </p>
      <p style="margin: 0; color: #555; font-size: 12px;">TaskNote — ${escapeHtml(params.appBaseUrl)}</p>
    </div>
  `;

  await transporter.sendMail({
    from: env.from,
    to: params.to,
    replyTo: env.from,
    subject,
    html,
  });
}

export async function sendOpsAlertEmail(params: {
  subject: string;
  lines: string[];
  recipients: string[];
}): Promise<boolean> {
  if (params.recipients.length === 0) return false;
  const resolved = getSmtpEnv();
  if (!resolved) return false;

  const { env } = resolved;
  const transporter = createSmtpTransport(env);

  const html = `<div style="font-family:Arial,sans-serif;line-height:1.5;color:#111;">${params.lines
    .map((line) => `<p style="margin:0 0 10px;">${escapeHtml(line)}</p>`)
    .join('')}</div>`;

  await transporter.sendMail({
    from: env.from,
    to: params.recipients.join(','),
    replyTo: env.from,
    subject: params.subject,
    html,
  });
  return true;
}
