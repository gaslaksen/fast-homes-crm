import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { useInboxCounts } from '@/features/dashboard/dashboard';

/**
 * Keeps the app icon badge on the unread count.
 *
 * The API stamps a badge on every new-message push, but that only moves the
 * number up. Reading a thread happens in-app, where APNs never hears about it,
 * so the badge has to be re-applied locally whenever the count changes.
 * Otherwise a red 3 sits on the icon after you have cleared the inbox.
 */
export function useBadgeSync(enabled: boolean) {
  const { data } = useInboxCounts(enabled);
  const unread = enabled ? (data?.unread ?? null) : 0;

  useEffect(() => {
    if (unread == null) return;
    Notifications.setBadgeCountAsync(unread).catch(() => {
      // Badge permission may be off; nothing else depends on this.
    });
  }, [unread]);
}
