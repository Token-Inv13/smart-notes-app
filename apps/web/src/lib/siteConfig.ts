const DEFAULT_SITE_URL = 'https://app.tachesnotes.com';

function normalizeSiteUrl(value: string | undefined): string {
  if (!value) return DEFAULT_SITE_URL;
  try {
    return new URL(value).origin;
  } catch {
    return DEFAULT_SITE_URL;
  }
}

export const SITE_URL = normalizeSiteUrl(process.env.NEXT_PUBLIC_APP_URL);
export const SITE_NAME = 'Smart Notes';
export const SITE_DESCRIPTION = 'Notes and tasks with reminders';
