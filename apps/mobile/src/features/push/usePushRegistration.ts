import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { api } from '@/lib/api';

// Show banners/sounds even when the app is foregrounded.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/**
 * Once signed in, request notification permission, read the native APNs device
 * token, and register it with the API (POST /push/devices). The backend sends
 * directly via APNs, so we need the raw device token (getDevicePushTokenAsync),
 * not an Expo push token. Best-effort: failures are swallowed.
 */
export function usePushRegistration(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    (async () => {
      try {
        // Push tokens are only issued on physical devices.
        if (!Device.isDevice) {
          console.warn('[push] skipped: not a physical device');
          return;
        }

        const existing = await Notifications.getPermissionsAsync();
        let granted = existing.granted;
        if (!granted && existing.canAskAgain) {
          const req = await Notifications.requestPermissionsAsync();
          granted = req.granted;
        }
        if (!granted) {
          console.warn(`[push] notification permission not granted (status=${existing.status})`);
          return;
        }
        if (cancelled) return;

        const token = await Notifications.getDevicePushTokenAsync(); // { type: 'apns', data }
        if (cancelled) return;
        console.log(`[push] got APNs token ${String(token.data).slice(0, 10)}…, registering`);

        await api.post('/push/devices', {
          platform: Platform.OS,
          apnsToken: String(token.data),
        });
        console.log('[push] device registered with API');
      } catch (e: any) {
        console.warn('[push] registration failed:', e?.message || String(e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled]);
}

export interface TestPushResult {
  sent: boolean;
  configured: boolean;
  devices: number;
}

/** Ask the API to send a test push to the current user's devices. Returns diagnostics. */
export async function sendTestPush(): Promise<TestPushResult> {
  const { data } = await api.post<TestPushResult>('/push/test');
  return data;
}
