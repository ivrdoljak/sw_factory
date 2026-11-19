import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import {
  coupons,
  courses,
  notifications,
  purchases,
  refunds,
  NotificationEventKind,
  RefundStatus,
} from "~/db/schema";

// ─── Notifications ───
// The only code that reads or writes Notifications (docs/adr/0013, spec #18).
//
// - Write side: `notify(tx, event)` works out who a Notification Event concerns,
//   drops the person who acted, and stores one Notification per recipient, in
//   the transaction of the change that raised it.
// - Read side: everything is scoped to one recipient. Notifications store
//   references, never text, so titles, links and detail are built here when
//   shown, from current data.
//
// Adding a Notification Event kind is additive: a member of the
// `NotificationEvent` union, a branch in `findDelivery`, and a branch in
// `render`.

type Db = BetterSQLite3Database<typeof schema>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Queryable = Db | Tx;

// ─── Notification Events ───

type RefundDecisionEvent = {
  kind:
    | NotificationEventKind.RefundRequestApproved
    | NotificationEventKind.RefundRequestDeclined;
  /** The Platform Admin who decided. */
  actorId: number;
  refundRequestId: number;
  raisedAt: Date;
};

/** A Notification Event with its facts: which kind, who acted, and the ids involved. */
export type NotificationEvent = RefundDecisionEvent;

// ─── Write side ───

type References = Pick<
  typeof notifications.$inferInsert,
  | "courseId"
  | "lessonId"
  | "commentId"
  | "refundRequestId"
  | "purchaseId"
  | "teamLicenceId"
>;

/** Who a Notification Event concerns, and what each of their Notifications refers to. */
type Delivery = { recipientIds: number[]; references: References };

const NOBODY: Delivery = { recipientIds: [], references: {} };

/**
 * Raises a Notification Event. Call it inside the transaction of the change
 * that raised it, so neither exists without the other. The person who acted is
 * never notified.
 */
export function notify(tx: Tx, event: NotificationEvent): void {
  const { recipientIds, references } = findDelivery(tx, event);
  const recipients = new Set(recipientIds);
  recipients.delete(event.actorId);

  if (recipients.size === 0) return;

  tx.insert(notifications)
    .values(
      [...recipients].map((recipientId) => ({
        recipientId,
        kind: event.kind,
        actorId: event.actorId,
        ...references,
        raisedAt: event.raisedAt.toISOString(),
      }))
    )
    .run();
}

/** The recipient rule for each Notification Event kind. */
function findDelivery(tx: Tx, event: NotificationEvent): Delivery {
  switch (event.kind) {
    case NotificationEventKind.RefundRequestApproved:
      return refundDecisionDelivery(tx, event);
    case NotificationEventKind.RefundRequestDeclined:
      return refundDecisionDelivery(tx, event);
  }
}

/** A decided Refund Request goes to the buyer of its Purchase. */
function refundDecisionDelivery(
  tx: Tx,
  event: RefundDecisionEvent
): Delivery {
  const found = tx
    .select({ purchase: purchases })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .where(eq(refunds.id, event.refundRequestId))
    .get();

  if (!found) return NOBODY;

  const { purchase } = found;

  // A Team Licence is the Purchase that granted Seats.
  const isTeamLicence = !!tx
    .select({ id: coupons.id })
    .from(coupons)
    .where(eq(coupons.purchaseId, purchase.id))
    .get();

  return {
    recipientIds: [purchase.userId],
    references: {
      courseId: purchase.courseId,
      refundRequestId: event.refundRequestId,
      ...(isTeamLicence
        ? { teamLicenceId: purchase.id }
        : { purchaseId: purchase.id }),
    },
  };
}

// ─── Read side ───

/** A Notification ready to display. */
export type NotificationForDisplay = {
  id: number;
  kind: NotificationEventKind;
  /** No trailing full stop: course and lesson titles may end in "?". */
  title: string;
  link: string;
  detail: string | null;
  /** The Refund Request's current status, shown only where the kind calls for it. */
  refundStatus: RefundStatus | null;
  raisedAt: string;
  read: boolean;
};

function selectNotifications(db: Queryable) {
  return db
    .select({
      notification: notifications,
      course: { title: courses.title, slug: courses.slug },
      refundRequest: {
        status: refunds.status,
        decisionNote: refunds.decisionNote,
      },
    })
    .from(notifications)
    .leftJoin(courses, eq(notifications.courseId, courses.id))
    .leftJoin(refunds, eq(notifications.refundRequestId, refunds.id));
}

type NotificationRow = ReturnType<
  ReturnType<typeof selectNotifications>["all"]
>[number];

/** How many Notifications the drawer loads at a time. */
export const NOTIFICATIONS_PAGE_SIZE = 20;

/**
 * Which of the recipient's Notifications to list. Filters and cursors belong
 * here; a cursor must be the (raisedAt, id) pair the list is sorted by, since
 * `raisedAt` comes from the event and doesn't follow insertion order.
 */
export type NotificationListQuery = {
  limit?: number;
};

/** The recipient's newest Notifications, newest first: one page of the drawer. */
export function listNotifications(
  db: Queryable,
  recipientId: number,
  { limit = NOTIFICATIONS_PAGE_SIZE }: NotificationListQuery = {}
): NotificationForDisplay[] {
  return selectNotifications(db)
    .where(eq(notifications.recipientId, recipientId))
    .orderBy(desc(notifications.raisedAt), desc(notifications.id))
    .limit(limit)
    .all()
    .flatMap((row) => {
      const rendered = render(row);
      return rendered ? [rendered] : [];
    });
}

/** How many of the recipient's Notifications are unread. */
export function countUnread(db: Queryable, recipientId: number): number {
  const result = db
    .select({ unread: count() })
    .from(notifications)
    .where(
      and(
        eq(notifications.recipientId, recipientId),
        isNull(notifications.readAt)
      )
    )
    .get();

  return result?.unread ?? 0;
}

/**
 * Marks one of the recipient's Notifications read. A Notification that is
 * already read keeps the time it was first read. Returns false when the
 * recipient has no Notification with that id.
 */
export function markRead(
  db: Queryable,
  recipientId: number,
  notificationId: number,
  at: Date = new Date()
): boolean {
  const result = db
    .update(notifications)
    .set({ readAt: sql`coalesce(${notifications.readAt}, ${at.toISOString()})` })
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.recipientId, recipientId)
      )
    )
    .run();

  return result.changes > 0;
}

// ─── Rendering ───

type Rendered = Pick<
  NotificationForDisplay,
  "title" | "link" | "detail" | "refundStatus"
>;

/** The renderer for each Notification Event kind. */
function render(row: NotificationRow): NotificationForDisplay | null {
  const rendered = renderKind(row);
  if (!rendered) return null;

  const { notification } = row;
  return {
    id: notification.id,
    kind: notification.kind,
    ...rendered,
    raisedAt: notification.raisedAt,
    read: notification.readAt !== null,
  };
}

function renderKind(row: NotificationRow): Rendered | null {
  switch (row.notification.kind) {
    case NotificationEventKind.RefundRequestApproved:
      return renderRefundRequestApproved(row);
    case NotificationEventKind.RefundRequestDeclined:
      return renderRefundRequestDeclined(row);
    // Not raised yet: each gets its renderer with the ticket that raises it.
    case NotificationEventKind.RefundRequestRaised:
    case NotificationEventKind.SeatClaimed:
    case NotificationEventKind.NewQuestion:
    case NotificationEventKind.NewReply:
      return null;
  }
}

function renderRefundRequestApproved(row: NotificationRow): Rendered {
  return {
    title: `Your refund request for ${courseTitle(row)} was approved`,
    link: refundDecisionLink(row),
    // An approval may carry a note too, but only a decline shows one.
    detail: null,
    refundStatus: null,
  };
}

function renderRefundRequestDeclined(row: NotificationRow): Rendered {
  return {
    title: `Your refund request for ${courseTitle(row)} was declined`,
    link: refundDecisionLink(row),
    detail: row.refundRequest?.decisionNote ?? null,
    refundStatus: null,
  };
}

function courseTitle(row: NotificationRow): string {
  return row.course?.title ?? "your course";
}

/** The course page, or the Team page for a Team Licence. */
function refundDecisionLink(row: NotificationRow): string {
  if (row.notification.teamLicenceId !== null) return "/team";
  return row.course ? `/courses/${row.course.slug}` : "/courses";
}
