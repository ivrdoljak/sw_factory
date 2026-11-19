import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Link, useFetcher, useNavigate } from "react-router";
import {
  Bell,
  CheckCheck,
  CircleCheck,
  CircleX,
  MessageSquare,
  Receipt,
  UserPlus,
} from "lucide-react";
import { NotificationEventKind, RefundStatus } from "~/db/schema";
import type {
  NotificationForDisplay,
  NotificationPage,
} from "~/lib/notifications.server";
import {
  encodeNotificationPosition,
  MarkIntent,
  NOTIFICATION_FILTERS,
  NOTIFICATIONS_PAGE_SIZE,
  type NotificationFilter,
  type NotificationPosition,
} from "~/lib/notifications";
import type { loader as notificationsLoader } from "~/routes/api.notifications";
import { cn, formatRelativeTime } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "~/components/ui/drawer";

// The sidebar's "Notifications" row and the drawer it opens. The drawer shows
// whatever the notifications endpoint returns, ready to display, so a new
// Notification Event kind needs nothing here beyond its icon.

const NOTIFICATIONS_ENDPOINT = "/api/notifications";

const FILTER_LABELS: Record<NotificationFilter, string> = {
  all: "All",
  unread: "Unread",
};

type NotificationsDrawerProps = {
  /** The count from the app layout loader, fresh on every page change. */
  unreadCount: number;
};

export function NotificationsDrawer({
  unreadCount: loaderUnreadCount,
}: NotificationsDrawerProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const list = useNotificationList(open, filter);
  const unreadCount = useNotificationCheck({
    loaderUnreadCount,
    shown: open ? list.notifications : null,
    filter,
    addNewer: list.addNewer,
  });
  const markFetcher = useFetcher();
  const markAllFetcher = useFetcher();
  const navigate = useNavigate();

  /**
   * Marks the Notification read, closes the drawer and goes to its page. The
   * navigation waits for the mark, so the page's loaders (and the badge) see
   * it. A click that opens a new tab only marks it read.
   */
  async function openNotification(
    event: MouseEvent<HTMLAnchorElement>,
    notification: NotificationForDisplay
  ) {
    const opensElsewhere =
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey;

    if (!opensElsewhere) {
      event.preventDefault();
      setOpen(false);
    }
    if (!notification.read) {
      list.setRead(notification.id, true);
      await markFetcher.submit(
        { intent: MarkIntent.Read, notificationId: notification.id },
        { method: "post", action: NOTIFICATIONS_ENDPOINT }
      );
    }
    if (!opensElsewhere) await navigate(notification.link);
  }

  function markAllRead() {
    list.setAllRead();
    void markAllFetcher.submit(
      { intent: MarkIntent.AllRead },
      { method: "post", action: NOTIFICATIONS_ENDPOINT }
    );
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
        >
          <Bell className="size-4" />
          <span className="flex-1 text-left">Notifications</span>
          <UnreadBadge count={unreadCount} />
        </button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Notifications</DrawerTitle>
          <DrawerDescription className="sr-only">
            Your newest Notifications. Opening one marks it read.
          </DrawerDescription>
        </DrawerHeader>
        <div className="flex items-center gap-1 border-b px-5 py-2">
          {NOTIFICATION_FILTERS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                filter === value
                  ? "bg-foreground text-background"
                  : "hover:bg-accent"
              )}
            >
              {value === "unread"
                ? `${FILTER_LABELS[value]} (${unreadCount})`
                : FILTER_LABELS[value]}
            </button>
          ))}
          <button
            type="button"
            onClick={markAllRead}
            disabled={unreadCount === 0 || markAllFetcher.state !== "idle"}
            className="ml-auto flex items-center gap-1 text-xs text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
          >
            <CheckCheck className="size-3.5" />
            Mark all as read
          </button>
        </div>
        {/* Scroll anchoring is done by hand in `useNotificationList`, the same
            in every browser, so the browser's own is off. */}
        <div
          ref={list.listRef}
          className="flex-1 overflow-y-auto [overflow-anchor:none]"
        >
          {list.notifications === null ? (
            <NotificationListSkeleton />
          ) : list.notifications.length === 0 ? (
            <EmptyState>
              {filter === "unread"
                ? "No unread Notifications."
                : "Nothing here yet."}
            </EmptyState>
          ) : (
            <>
              {groupByAge(list.notifications, Date.now()).map((group) => (
                <section key={group.label}>
                  <h3 className="bg-muted/50 px-5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {group.label}
                  </h3>
                  {group.notifications.map((notification) => (
                    <NotificationRow
                      key={notification.id}
                      notification={notification}
                      onOpen={(event) =>
                        void openNotification(event, notification)
                      }
                      onMarked={(read) => list.setRead(notification.id, read)}
                    />
                  ))}
                </section>
              ))}
              {list.hasOlder && (
                <div className="flex justify-center px-5 py-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={list.loadOlder}
                    disabled={list.loadingOlder}
                  >
                    {list.loadingOlder ? "Loading…" : "Load older"}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

type NotificationListState = Omit<NotificationPage, "notifications"> & {
  /** Null while the newest page for the filter is loading. */
  notifications: NotificationForDisplay[] | null;
};

const LOADING: NotificationListState = { notifications: null, hasOlder: false };

type ListResponse = Awaited<ReturnType<typeof notificationsLoader>>;

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
function useNotificationList(open: boolean, filter: NotificationFilter) {
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
function useNotificationCheck({
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

/** The unread badge: hidden at zero, "9+" above nine. */
function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      aria-label={`${count} unread`}
      className="inline-flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-[11px] font-semibold leading-5 text-white"
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

type NotificationGroup = {
  label: "Last 24 hours" | "Earlier";
  notifications: NotificationForDisplay[];
};

/** Splits a newest-first list into "Last 24 hours" and "Earlier", dropping an empty group. */
function groupByAge(
  notifications: NotificationForDisplay[],
  now: number
): NotificationGroup[] {
  const recent: NotificationForDisplay[] = [];
  const earlier: NotificationForDisplay[] = [];
  for (const notification of notifications) {
    const age = now - Date.parse(notification.raisedAt);
    (age < DAY_MS ? recent : earlier).push(notification);
  }
  const groups: NotificationGroup[] = [
    { label: "Last 24 hours", notifications: recent },
    { label: "Earlier", notifications: earlier },
  ];
  return groups.filter((group) => group.notifications.length > 0);
}

const KIND_ICONS: Record<NotificationEventKind, ReactNode> = {
  [NotificationEventKind.RefundRequestApproved]: (
    <CircleCheck className="size-4 text-green-600 dark:text-green-400" />
  ),
  [NotificationEventKind.RefundRequestDeclined]: (
    <CircleX className="size-4 text-red-600 dark:text-red-400" />
  ),
  [NotificationEventKind.RefundRequestRaised]: (
    <Receipt className="size-4 text-amber-600 dark:text-amber-400" />
  ),
  [NotificationEventKind.SeatClaimed]: (
    <UserPlus className="size-4 text-blue-600 dark:text-blue-400" />
  ),
  [NotificationEventKind.NewQuestion]: (
    <MessageSquare className="size-4 text-violet-600 dark:text-violet-400" />
  ),
  [NotificationEventKind.NewReply]: (
    <MessageSquare className="size-4 text-sky-600 dark:text-sky-400" />
  ),
};

const REFUND_STATUS_TAGS: Record<
  RefundStatus,
  { label: string; className: string }
> = {
  [RefundStatus.Open]: {
    label: "Open",
    className:
      "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  },
  [RefundStatus.Approved]: {
    label: "Approved",
    className:
      "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  },
  [RefundStatus.Declined]: {
    label: "Declined",
    className: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  },
};

function NotificationRow({
  notification,
  onOpen,
  onMarked,
}: {
  notification: NotificationForDisplay;
  onOpen: (event: MouseEvent<HTMLAnchorElement>) => void;
  /** Called as soon as the row is marked read or unread from its hover link. */
  onMarked: (read: boolean) => void;
}) {
  // Each row marks through its own fetcher, so quick marks on several rows
  // don't cancel one another.
  const markFetcher = useFetcher();
  const unread = !notification.read;

  /** Toggles read and unread without opening the Notification. */
  function toggleRead() {
    onMarked(unread);
    void markFetcher.submit(
      {
        intent: unread ? MarkIntent.Read : MarkIntent.Unread,
        notificationId: notification.id,
      },
      { method: "post", action: NOTIFICATIONS_ENDPOINT }
    );
  }
  const statusTag = notification.refundStatus
    ? REFUND_STATUS_TAGS[notification.refundStatus]
    : null;

  return (
    <article
      className={cn(
        "group relative flex gap-3 border-b px-5 py-4 transition-colors hover:bg-accent/40",
        unread && "border-l-4 border-l-primary pl-4"
      )}
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
        {KIND_ICONS[notification.kind]}
      </div>
      <div className="min-w-0 flex-1">
        {/* The link stretches over the whole row, so clicking anywhere opens it.
            Any other control in the row needs `relative z-10` to sit above it. */}
        <Link
          to={notification.link}
          onClick={onOpen}
          className={cn(
            "text-left text-sm after:absolute after:inset-0 group-hover:underline focus-visible:outline-none",
            unread && "font-semibold"
          )}
        >
          {notification.title}
        </Link>
        {notification.detail && (
          <p className="mt-1 rounded-md bg-muted/60 px-2.5 py-1.5 text-xs text-muted-foreground">
            {notification.detail}
          </p>
        )}
        <div className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground">
          {statusTag && (
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
                statusTag.className
              )}
            >
              {statusTag.label}
            </span>
          )}
          <time dateTime={notification.raisedAt} suppressHydrationWarning>
            {formatRelativeTime(notification.raisedAt)}
          </time>
          <button
            type="button"
            onClick={toggleRead}
            className="relative z-10 opacity-0 transition-opacity hover:text-foreground hover:underline focus-visible:opacity-100 group-hover:opacity-100"
          >
            {unread ? "Mark as read" : "Mark as unread"}
          </button>
        </div>
      </div>
    </article>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
      <CheckCheck className="size-8 opacity-40" />
      {children}
    </div>
  );
}

function NotificationListSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading Notifications">
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex gap-3 border-b px-5 py-4">
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/4" />
          </div>
        </div>
      ))}
    </div>
  );
}
