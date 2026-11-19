import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
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
import type { NotificationForDisplay } from "~/lib/notifications.server";
import type { loader as notificationsLoader } from "~/routes/api.notifications";
import { cn, formatRelativeTime } from "~/lib/utils";
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

type NotificationsDrawerProps = { unreadCount: number };

export function NotificationsDrawer({ unreadCount }: NotificationsDrawerProps) {
  const [open, setOpen] = useState(false);
  const notifications = useNotificationList(open);
  const markFetcher = useFetcher();
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
      await markFetcher.submit(
        { intent: "mark-read", notificationId: notification.id },
        { method: "post", action: NOTIFICATIONS_ENDPOINT }
      );
    }
    if (!opensElsewhere) await navigate(notification.link);
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
        <div className="flex-1 overflow-y-auto">
          {notifications === null ? (
            <NotificationListSkeleton />
          ) : notifications.length === 0 ? (
            <EmptyState>Nothing here yet.</EmptyState>
          ) : (
            groupByAge(notifications, Date.now()).map((group) => (
              <section key={group.label}>
                <h3 className="bg-muted/50 px-5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </h3>
                {group.notifications.map((notification) => (
                  <NotificationRow
                    key={notification.id}
                    notification={notification}
                    onOpen={(event) => void openNotification(event, notification)}
                  />
                ))}
              </section>
            ))
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

/**
 * The drawer's list: null until the newest page has loaded. Every opening
 * loads it afresh, and opening marks nothing read.
 */
function useNotificationList(open: boolean): NotificationForDisplay[] | null {
  const fetcher = useFetcher<typeof notificationsLoader>();
  const { load } = fetcher;
  const [notifications, setNotifications] = useState<
    NotificationForDisplay[] | null
  >(null);

  useEffect(() => {
    if (!open) return;
    setNotifications(null);
    void load(NOTIFICATIONS_ENDPOINT);
  }, [open, load]);

  // The newest page replaces the list. Older pages and newer arrivals will
  // merge in here rather than replace it.
  useEffect(() => {
    if (fetcher.data) setNotifications(fetcher.data.notifications);
  }, [fetcher.data]);

  return notifications;
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
}: {
  notification: NotificationForDisplay;
  onOpen: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const unread = !notification.read;
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
        {/* The link stretches over the whole row, so clicking anywhere opens it. */}
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
