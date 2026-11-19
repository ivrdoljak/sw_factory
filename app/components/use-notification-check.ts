import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import type { NotificationForDisplay } from "~/lib/notifications.server";
import {
  encodeNotificationPosition,
  NOTIFICATIONS_ENDPOINT,
  type NotificationFilter,
} from "~/lib/notifications";
import type { loader as notificationsLoader } from "~/routes/api.notifications";
import type { ListResponse } from "~/components/use-notification-list";

// The notifications drawer's visible-tab check for new Notifications. See
// NotificationsDrawer.

/** How often to check for new Notifications while the tab is visible. */
const CHECK_INTERVAL_MS = 30_000;

/**
 * Checks about every 30 seconds, while the tab is visible, for new
 * Notifications, and returns the unread count for the badge. With the drawer
 * open, the same check fetches the Notifications newer than the newest shown,
 * under the current filter, and adds them to the top.
 *
 * Arrivals change only the badge: no toast, sound or tab title. The check
 * loads the notifications endpoint with a fetcher, so the heavy app layout
 * loader doesn't rerun.
 */
export function useNotificationCheck({
  loaderUnreadCount,
  shown,
  filter,
  addNewer,
}: {
  loaderUnreadCount: number;
  /** The drawer's list while it's open and loaded, otherwise null. */
  shown: NotificationForDisplay[] | null;
  filter: NotificationFilter;
  addNewer: (response: ListResponse) => void;
}): number {
  const fetcher = useFetcher<typeof notificationsLoader>();
  const { load } = fetcher;
  const [unreadCount, setUnreadCount] = useState(loaderUnreadCount);

  // Whichever answered last wins: the layout loader on a page change or after
  // a mark, or this check.
  useEffect(() => setUnreadCount(loaderUnreadCount), [loaderUnreadCount]);

  const addNewerRef = useRef(addNewer);
  useEffect(() => {
    addNewerRef.current = addNewer;
  });

  useEffect(() => {
    if (!fetcher.data) return;
    setUnreadCount(fetcher.data.unreadCount);
    addNewerRef.current(fetcher.data);
  }, [fetcher.data]);

  useVisibleTabInterval(
    () => void load(notificationCheckUrl(shown, filter)),
    CHECK_INTERVAL_MS
  );

  return unreadCount;
}

/**
 * The count alone, or with the drawer open, the Notifications under its filter
 * newer than the newest shown.
 */
function notificationCheckUrl(
  shown: NotificationForDisplay[] | null,
  filter: NotificationFilter
): string {
  if (shown === null) return `${NOTIFICATIONS_ENDPOINT}?only=unread-count`;

  const params = new URLSearchParams({ filter });
  const newest = shown[0];
  // An open drawer with nothing in it yet checks the newest page.
  if (newest) params.set("newerThan", encodeNotificationPosition(newest));
  return `${NOTIFICATIONS_ENDPOINT}?${params}`;
}

/**
 * Calls `callback` every `intervalMs` while the tab is visible (Page
 * Visibility API). Hidden, it stops; visible again, it calls at once and
 * starts over.
 */
function useVisibleTabInterval(callback: () => void, intervalMs: number) {
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;

    function start() {
      clearInterval(timer);
      timer = setInterval(() => callbackRef.current(), intervalMs);
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        callbackRef.current();
        start();
      } else {
        clearInterval(timer);
      }
    }

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [intervalMs]);
}
