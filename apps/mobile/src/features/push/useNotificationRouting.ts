import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useRootNavigationState } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useAuth } from '@/lib/auth';

type PendingTap = { type?: string; leadId: string };

/** Set once at module load so a cold-start tap is never missed. */
let coldStartTap: PendingTap | null = null;
let coldStartRead = false;

function readTap(data: any): PendingTap | null {
  const leadId = data?.leadId;
  if (!leadId || typeof leadId !== 'string') return null;
  return { type: typeof data?.type === 'string' ? data.type : undefined, leadId };
}

/**
 * Deep-links notification taps. Our APNs payload carries `leadId` + `type`
 * (set by the API PushService): a new-lead alert opens that lead's detail
 * page, a new-message alert opens the conversation.
 *
 * A tap is held until auth has restored AND the root navigator is mounted, then
 * replayed. Two things used to drop it on a cold start and leave you on Home:
 * the tap could arrive before this effect subscribed, and the target tab's
 * navigator was not always mounted at the moment we pushed. So the cold-start
 * response is read once at module load, and the navigation is retried until the
 * route actually changes.
 */
export function useNotificationRouting() {
  const router = useRouter();
  const navReady = !!useRootNavigationState()?.key;
  const pathname = usePathname();
  const { token, loading } = useAuth();
  const [pending, setPending] = useState<PendingTap | null>(null);
  const attempts = useRef(0);

  useEffect(() => {
    // Cold start: was the app opened by tapping a notification? Read once,
    // because getLastNotificationResponseAsync keeps returning the same
    // response, and replaying it on every mount would yank the user around.
    if (!coldStartRead) {
      coldStartRead = true;
      Notifications.getLastNotificationResponseAsync()
        .then((last) => {
          const tap = last && readTap(last.notification.request.content.data);
          if (tap) {
            coldStartTap = tap;
            setPending(tap);
          }
        })
        .catch(() => {
          // No launch response available; warm taps still work.
        });
    } else if (coldStartTap) {
      setPending(coldStartTap);
    }

    // Warm: tapped while the app is running or backgrounded.
    const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
      const tap = readTap(resp.notification.request.content.data);
      if (tap) {
        attempts.current = 0;
        setPending(tap);
      }
    });
    return () => sub.remove();
  }, []);

  // Navigate once everything the deep link needs actually exists.
  useEffect(() => {
    if (!pending || !navReady || loading || !token) return;

    const { type, leadId } = pending;

    // Already there: the tap landed.
    if (pathname.includes(leadId)) {
      coldStartTap = null;
      attempts.current = 0;
      setPending(null);
      return;
    }

    // Give up rather than fighting the user for control of the screen.
    if (attempts.current >= 5) {
      coldStartTap = null;
      attempts.current = 0;
      setPending(null);
      return;
    }

    // On a cold start the tab navigator can still be mounting when the root
    // reports ready, and a push into it is dropped on the floor, which is how
    // a tapped notification used to dump you on Home. Fire on the next tick,
    // then re-run: the pathname check above either confirms it took or we try
    // again a beat later.
    attempts.current += 1;
    const delay = attempts.current === 1 ? 0 : 250;
    const t = setTimeout(() => {
      if (type === 'message') {
        // `from` sends the conversation's back arrow to the Inbox rather than
        // to whatever screen happened to be open when the alert arrived.
        router.push({ pathname: '/lead/[id]', params: { id: leadId, from: 'inbox' } });
      } else {
        router.push({ pathname: '/lead/detail/[id]', params: { id: leadId } });
      }
      // Nudge the effect to re-run so the pathname check can confirm.
      setPending((p) => (p ? { ...p } : p));
    }, delay);
    return () => clearTimeout(t);
  }, [pending, navReady, loading, token, pathname]);
}
