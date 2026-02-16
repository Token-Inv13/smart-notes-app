import { logEvent } from 'firebase/analytics';
import { getAnalyticsInstance } from '@/lib/firebase';

export async function trackEvent(eventName: string, params?: Record<string, string | number | boolean | null>) {
  try {
    const analytics = await getAnalyticsInstance();
    if (!analytics) return;
    logEvent(analytics, eventName, params ?? {});
  } catch {
    // Analytics failures must never block product flows.
  }
}
