import { headers } from 'next/headers';

const FALLBACK_APP_ORIGIN = 'https://app.tachesnotes.com';

function parseOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function isValidForwardedHost(value: string): boolean {
  return /^[a-z0-9.-]+(?::\d+)?$/i.test(value);
}

export async function getServerAppOrigin(): Promise<string> {
  const configuredOrigin =
    parseOrigin(process.env.NEXT_PUBLIC_APP_URL) ?? parseOrigin(process.env.APP_BASE_URL) ?? null;
  if (configuredOrigin) return configuredOrigin;

  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  if (!host || !isValidForwardedHost(host)) return FALLBACK_APP_ORIGIN;

  const proto = h.get('x-forwarded-proto') === 'http' ? 'http' : 'https';
  return `${proto}://${host}`;
}
