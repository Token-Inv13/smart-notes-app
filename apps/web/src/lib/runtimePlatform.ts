export type NativePlatform = 'android' | 'ios' | 'unknown';

export interface RuntimePlatformInfo {
  isNative: boolean;
  nativePlatform: NativePlatform;
  isPwa: boolean;
}

export function getRuntimePlatformInfo(): RuntimePlatformInfo {
  const isNative = (() => {
    try {
      const cap = (globalThis as any)?.Capacitor;
      return Boolean(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
    } catch {
      return false;
    }
  })();

  const nativePlatform: NativePlatform = (() => {
    if (!isNative) return 'unknown';
    try {
      const cap = (globalThis as any)?.Capacitor;
      const platform =
        typeof cap?.getPlatform === 'function'
          ? String(cap.getPlatform())
          : typeof cap?.platform === 'string'
            ? String(cap.platform)
            : '';

      if (platform === 'android' || platform === 'ios') return platform;
      return 'unknown';
    } catch {
      return 'unknown';
    }
  })();

  const isPwa = (() => {
    if (typeof window === 'undefined') return false;
    try {
      const standalone = window.matchMedia?.('(display-mode: standalone)')?.matches;
      const iOSStandalone = Boolean((navigator as any)?.standalone);
      return Boolean(standalone || iOSStandalone);
    } catch {
      return false;
    }
  })();

  return { isNative, nativePlatform, isPwa };
}

export function isAndroidNative(): boolean {
  const info = getRuntimePlatformInfo();
  return info.isNative && info.nativePlatform === 'android';
}
