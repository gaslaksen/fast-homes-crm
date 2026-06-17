import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';

/**
 * Deep-links notification taps. Our APNs payload carries `leadId` (set by the
 * API PushService), so a tap on a new-lead or new-message alert opens that
 * conversation. Handles both cold start (app launched from the notification)
 * and warm taps (app already running).
 */
export function useNotificationRouting() {
  const router = useRouter();

  useEffect(() => {
    let handled = false;

    const open = (data: any) => {
      const leadId = data?.leadId as string | undefined;
      if (leadId) router.push({ pathname: '/lead/[id]', params: { id: leadId } });
    };

    // Cold start: was the app opened by tapping a notification?
    (async () => {
      const last = await Notifications.getLastNotificationResponseAsync();
      if (last && !handled) {
        handled = true;
        open(last.notification.request.content.data);
      }
    })();

    // Warm: tapped while the app is running.
    const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
      open(resp.notification.request.content.data);
    });

    return () => sub.remove();
  }, []);
}
