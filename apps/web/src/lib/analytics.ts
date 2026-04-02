import { logEvent } from 'firebase/analytics';
import { getAnalyticsInstance } from '@/lib/firebase';

type AnalyticsEventParams = Record<string, string | number | boolean | null>;

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
