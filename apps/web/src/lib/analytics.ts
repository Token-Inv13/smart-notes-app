import { logEvent } from 'firebase/analytics';
import { getAnalyticsInstance } from '@/lib/firebase';

type AnalyticsEventParams = Record<string, string | number | boolean | null>;
type GtagCommand = 'js' | 'config' | 'event' | 'set' | 'consent';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

function hasSafeAnalyticsWindow() {
  if (typeof window === 'undefined') return false;
  if (!window.dataLayer || !Array.isArray(window.dataLayer)) return false;
  if (typeof window.gtag !== 'function') return false;
  return true;
}

export function safeGtag(command: GtagCommand, target: string | Date, params?: Record<string, unknown>) {
  if (!hasSafeAnalyticsWindow()) return;

  if (command === 'js' && target instanceof Date) {
    window.gtag?.('js', target);
    return;
  }

  if (typeof target !== 'string') return;
  window.gtag?.(command, target, params ?? {});
}

export function safeTrackEvent(eventName: string, params?: AnalyticsEventParams) {
  if (!hasSafeAnalyticsWindow()) return;
  window.gtag?.('event', eventName, params ?? {});
}

export async function trackEvent(eventName: string, params?: AnalyticsEventParams) {
  try {
    const analytics = await getAnalyticsInstance();
    if (!analytics) return;
    logEvent(analytics, eventName, params ?? {});
  } catch {
    // Analytics failures must never block product flows.
  }
}

export async function trackEventBeforeNavigation(
  eventName: string,
  params?: AnalyticsEventParams,
  delayMs = 150,
) {
  await trackEvent(eventName, params);

  if (typeof window === 'undefined') return;

  await new Promise<void>((resolve) => {
    window.setTimeout(() => resolve(), delayMs);
  });
}
