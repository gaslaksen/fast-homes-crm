import { useEffect, useState } from 'react';
import { useRouter, useRootNavigationState } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useAuth } from '@/lib/auth';

type PendingTap = { type?: string; leadId: string };

/**
 * Deep-links notification taps. Our APNs payload carries `leadId` + `type`
 * (set by the API PushService): a new-lead alert opens that lead's detail
 * page, a new-message alert opens the conversation. Taps are captured
 * immediately but held until auth has restored AND the root navigator is
 * mounted — on a cold start the tap used to fire before navigation existed,
 * get dropped, and the app would land on Home.
 */
export function useNotificationRouting() {
  const router = useRouter();
  const navReady = !!useRootNavigationState()?.key;
  const { token, loading } = useAuth();
  const [pending, setPending] = useState<PendingTap | null>(null);

  useEffect(() => {
    const capture = (data: any) => {
      const leadId = data?.leadId as string | undefined;
      if (leadId) setPending({ type: data?.type as string | undefined, leadId });
    };

    // Cold start: was the app opened by tapping a notification?
    Notifications.getLastNotificationResponseAsync().then((last) => {
      if (last) capture(last.notification.request.content.data);
    });

    // Warm: tapped while the app is running.
    const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
      capture(resp.notification.request.content.data);
    });
    return () => sub.remove();
  }, []);

  // Navigate once everything the deep link needs actually exists.
  useEffect(() => {
    if (!pending || !navReady || loading || !token) return;
    const { type, leadId } = pending;
    setPending(null);
    router.push(
      type === 'message'
        ? { pathname: '/lead/[id]', params: { id: leadId } }
        : { pathname: '/lead/detail/[id]', params: { id: leadId } },
    );
  }, [pending, navReady, loading, token]);
}
