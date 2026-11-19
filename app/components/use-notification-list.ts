import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import type {
  NotificationForDisplay,
  NotificationPage,
} from "~/lib/notifications.server";
import {
  encodeNotificationPosition,
  NOTIFICATIONS_ENDPOINT,
  NOTIFICATIONS_PAGE_SIZE,
  type NotificationFilter,
  type NotificationPosition,
} from "~/lib/notifications";
import type { loader as notificationsLoader } from "~/routes/api.notifications";

// The notifications drawer's list: loading, paging, merging pages and
// arrivals, and keeping the scroll position steady. See NotificationsDrawer.

type NotificationListState = Omit<NotificationPage, "notifications"> & {
  /** Null while the newest page for the filter is loading. */
  notifications: NotificationForDisplay[] | null;
};

const LOADING: NotificationListState = { notifications: null, hasOlder: false };

export type ListResponse = Awaited<ReturnType<typeof notificationsLoader>>;

/** The page in a response, or null if it has none or was loaded for another filter. */
function pageFor(
  response: ListResponse | undefined,
  filter: NotificationFilter
): NotificationPage | null {
  if (!response || !("notifications" in response)) return null;
  return response.filter === filter ? response : null;
}

/**
 * The drawer's list for the current filter. Every opening, and every switch of
 * filter, loads the newest page afresh; opening marks nothing read. "Load
 * older" appends the next page, by the position of the oldest one shown, so
 * arrivals added to the top don't disturb it.
 *
 * After any mark, React Router reloads each fetcher's last page. Pages are
 * therefore merged by id, never replacing what's shown, and marks change the
 * list here straight away rather than waiting for those reloads.
 */
export function useNotificationList(open: boolean, filter: NotificationFilter) {
  const newestFetcher = useFetcher<typeof notificationsLoader>();
  const olderFetcher = useFetcher<typeof notificationsLoader>();
  const [state, setState] = useState<NotificationListState>(LOADING);
  const filterRef = useRef(filter);
  filterRef.current = filter;
  const listRef = useRef<HTMLDivElement>(null);
  const scrollBeforeArrivals = useRef<{
    scrollTop: number;
    scrollHeight: number;
  } | null>(null);
  // Whether "Load older" was used on the list shown. The older fetcher keeps
  // its last URL after the list resets, and reloads it after any mark; that
  // page belongs to the old list and would leave a gap in the new one.
  const olderPagesShown = useRef(false);

  const { load: loadNewest } = newestFetcher;
  useEffect(() => {
    if (!open) return;
    olderPagesShown.current = false;
    setState(LOADING);
    void loadNewest(listUrl(filter));
  }, [open, filter, loadNewest]);

  // Each page is handled once, when it arrives. One loaded for another filter
  // is dropped, and an older page only extends the list it was loaded for.
  useEffect(() => {
    const page = pageFor(newestFetcher.data, filterRef.current);
    if (!page) return;
    scrollBeforeArrivals.current = null;
    setState((list) =>
      list.notifications === null ? page : mergePage(asPage(list), page)
    );
  }, [newestFetcher.data]);
  useEffect(() => {
    const page = pageFor(olderFetcher.data, filterRef.current);
    if (!page || !olderPagesShown.current) return;
    setState((list) =>
      list.notifications === null ? list : mergePage(asPage(list), page)
    );
  }, [olderFetcher.data]);

  function loadOlder() {
    const oldest = state.notifications?.at(-1);
    if (!oldest) return;
    olderPagesShown.current = true;
    void olderFetcher.load(listUrl(filter, oldest));
  }

  /**
   * Adds Notifications newer than the newest shown to the top of the list.
   * Someone scrolled down keeps their place; at the very top they see the
   * arrivals. A full page of them may not meet the rows shown, so it
   * replaces the list rather than leave a gap.
   */
  function addNewer(response: ListResponse) {
    const page = pageFor(response, filterRef.current);
    const notifications = state.notifications;
    if (!page || notifications === null) return;
    const shownIds = new Set(notifications.map((notification) => notification.id));
    const arrivals = page.notifications.filter(
      (notification) => !shownIds.has(notification.id)
    );
    if (arrivals.length === 0) return;

    if (page.notifications.length >= NOTIFICATIONS_PAGE_SIZE) {
      scrollBeforeArrivals.current = null;
      setState({
        notifications: page.notifications,
        // What was shown is older than all of them.
        hasOlder: page.hasOlder || notifications.length > 0,
      });
      return;
    }

    const list = listRef.current;
    scrollBeforeArrivals.current =
      list && list.scrollTop > 0
        ? { scrollTop: list.scrollTop, scrollHeight: list.scrollHeight }
        : null;
    setState((current) =>
      current.notifications === null
        ? current
        : mergePage(asPage(current), { notifications: arrivals, hasOlder: page.hasOlder })
    );
  }

  // Shifts the scroll by the height the arrivals added, so the rows the person
  // is looking at stay where they are.
  useLayoutEffect(() => {
    const before = scrollBeforeArrivals.current;
    const list = listRef.current;
    scrollBeforeArrivals.current = null;
    if (!before || !list) return;
    list.scrollTop = before.scrollTop + (list.scrollHeight - before.scrollHeight);
  }, [state.notifications]);

  function setRead(id: number, read: boolean) {
    setState((list) => ({
      ...list,
      notifications:
        list.notifications?.map((n) => (n.id === id ? { ...n, read } : n)) ??
        null,
    }));
  }

  /** Under Unread nothing is left to show; under All everything turns read. */
  function setAllRead() {
    setState((list) =>
      filterRef.current === "unread"
        ? { notifications: [], hasOlder: false }
        : {
            ...list,
            notifications:
              list.notifications?.map((n) => ({ ...n, read: true })) ?? null,
          }
    );
  }

  return {
    notifications: state.notifications,
    hasOlder: state.hasOlder,
    loadingOlder: olderFetcher.state === "loading",
    loadOlder,
    addNewer,
    setRead,
    setAllRead,
    listRef,
  };
}

/** The list as a page, loading counting as empty. */
function asPage({ notifications, hasOlder }: NotificationListState): NotificationPage {
  return { notifications: notifications ?? [], hasOlder };
}

/** A page of the list for the filter: the newest, or the one before a position. */
function listUrl(filter: NotificationFilter, before?: NotificationPosition) {
  const params = new URLSearchParams({ filter });
  if (before) params.set("before", encodeNotificationPosition(before));
  return `${NOTIFICATIONS_ENDPOINT}?${params}`;
}

/** Newest first, by the (raisedAt, id) pair the server sorts by. */
function newestFirst(a: NotificationPosition, b: NotificationPosition): number {
  if (a.raisedAt !== b.raisedAt) return a.raisedAt < b.raisedAt ? 1 : -1;
  return b.id - a.id;
}

/**
 * Adds a page to the list shown, updating the Notifications it already has.
 * Nothing shown is removed. Whether older ones exist is taken from the page
 * only when it reaches the bottom of the list.
 */
function mergePage(list: NotificationPage, page: NotificationPage): NotificationPage {
  const byId = new Map(list.notifications.map((n) => [n.id, n]));
  for (const notification of page.notifications) {
    byId.set(notification.id, notification);
  }
  const notifications = [...byId.values()].sort(newestFirst);
  const oldest = notifications.at(-1);
  const reachesBottom =
    oldest !== undefined && page.notifications.some((n) => n.id === oldest.id);
  return {
    notifications,
    hasOlder: reachesBottom ? page.hasOlder : list.hasOlder,
  };
}
