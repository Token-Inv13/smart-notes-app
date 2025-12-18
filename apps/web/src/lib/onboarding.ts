'use client';

const PREFIX = 'sn:onboarding:';

function scopedKey(userId: string, key: string) {
  return `${PREFIX}${userId}:${key}`;
}

export function getOnboardingFlag(userId: string, key: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(scopedKey(userId, key)) === '1';
  } catch {
    return false;
  }
}

export function setOnboardingFlag(userId: string, key: string, value: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(scopedKey(userId, key), value ? '1' : '0');
  } catch {
    // ignore
  }
}
