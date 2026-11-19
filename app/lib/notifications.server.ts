import { and, count, desc, eq, isNull } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { alias } from "drizzle-orm/sqlite-core";
import * as schema from "~/db/schema";
import {
  coupons,
  courses,
  notifications,
  purchases,
  refunds,
  users,
  NotificationEventKind,
  RefundStatus,
  UserRole,
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

type RefundRequestRaisedEvent = {
  kind: NotificationEventKind.RefundRequestRaised;
  /** The buyer who raised it. */
  actorId: number;
  refundRequestId: number;
  raisedAt: Date;
};

type SeatClaimedEvent = {
  kind: NotificationEventKind.SeatClaimed;
  /** The Student who claimed the Seat. */
  actorId: number;
  seatId: number;
  raisedAt: Date;
};

/** A Notification Event with its facts: which kind, who acted, and the ids involved. */
export type NotificationEvent =
  | RefundDecisionEvent
  | RefundRequestRaisedEvent
  | SeatClaimedEvent;

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
    case NotificationEventKind.RefundRequestRaised:
      return refundRequestRaisedDelivery(tx, event);
    case NotificationEventKind.SeatClaimed:
      return seatClaimedDelivery(tx, event);
  }
}

/** A decided Refund Request goes to the buyer of its Purchase. */
function refundDecisionDelivery(
  tx: Tx,
  event: RefundDecisionEvent
): Delivery {
  const found = findRefundRequest(tx, event.refundRequestId);
  if (!found) return NOBODY;

  return { recipientIds: [found.buyerId], references: found.references };
}

/**
 * A raised Refund Request goes to every Platform Admin, so no request depends
 * on one person watching the Refund Requests page.
 */
function refundRequestRaisedDelivery(
  tx: Tx,
  event: RefundRequestRaisedEvent
): Delivery {
  const found = findRefundRequest(tx, event.refundRequestId);
  if (!found) return NOBODY;

  const platformAdmins = tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, UserRole.Admin))
    .all();

  return {
    recipientIds: platformAdmins.map((platformAdmin) => platformAdmin.id),
    references: found.references,
  };
}

/** The buyer of a Refund Request's Purchase, and what its Notifications refer to. */
function findRefundRequest(
  tx: Tx,
  refundRequestId: number
): { buyerId: number; references: References } | null {
  const found = tx
    .select({ purchase: purchases })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .where(eq(refunds.id, refundRequestId))
    .get();

  if (!found) return null;

  const { purchase } = found;

  // A Team Licence is the Purchase that granted Seats.
  const isTeamLicence = !!tx
    .select({ id: coupons.id })
    .from(coupons)
    .where(eq(coupons.purchaseId, purchase.id))
    .get();

  return {
    buyerId: purchase.userId,
    references: {
      courseId: purchase.courseId,
      refundRequestId,
      ...(isTeamLicence
        ? { teamLicenceId: purchase.id }
        : { purchaseId: purchase.id }),
    },
  };
}

/** A claimed Seat goes to the Team Admin who bought its Team Licence. */
function seatClaimedDelivery(tx: Tx, event: SeatClaimedEvent): Delivery {
  const found = tx
    .select({ teamLicence: purchases })
    .from(coupons)
    .innerJoin(purchases, eq(coupons.purchaseId, purchases.id))
    .where(eq(coupons.id, event.seatId))
    .get();

  if (!found) return NOBODY;

  const { teamLicence } = found;
  return {
    recipientIds: [teamLicence.userId],
    references: {
      courseId: teamLicence.courseId,
      teamLicenceId: teamLicence.id,
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

const actors = alias(users, "actors");

function selectNotifications(db: Queryable) {
  return db
    .select({
      notification: notifications,
      actor: { name: actors.name },
      course: { title: courses.title, slug: courses.slug },
      refundRequest: {
        status: refunds.status,
        decisionNote: refunds.decisionNote,
      },
    })
    .from(notifications)
    .leftJoin(actors, eq(notifications.actorId, actors.id))
    .leftJoin(courses, eq(notifications.courseId, courses.id))
    .leftJoin(refunds, eq(notifications.refundRequestId, refunds.id));
}

type NotificationRow = ReturnType<
  ReturnType<typeof selectNotifications>["all"]
>[number];

/** The recipient's Notifications, newest first. */
export function listNotifications(
  db: Queryable,
  recipientId: number
): NotificationForDisplay[] {
  return selectNotifications(db)
    .where(eq(notifications.recipientId, recipientId))
    .orderBy(desc(notifications.raisedAt), desc(notifications.id))
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
    case NotificationEventKind.RefundRequestRaised:
      return renderRefundRequestRaised(row);
    case NotificationEventKind.SeatClaimed:
      return renderSeatClaimed(row);
    // Not raised yet: each gets its renderer with the ticket that raises it.
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

function renderRefundRequestRaised(row: NotificationRow): Rendered {
  const course = row.course?.title ?? "a course";
  return {
    title: `${actorName(row)} requested a refund for ${course}`,
    link: "/admin/refunds",
    detail: null,
    // Read live, so a Platform Admin can see another has already decided it.
    refundStatus: row.refundRequest?.status ?? null,
  };
}

function renderSeatClaimed(row: NotificationRow): Rendered {
  return {
    title: `${actorName(row)} claimed a Seat on ${courseTitle(row)}`,
    link: "/team",
    detail: null,
    refundStatus: null,
  };
}

function actorName(row: NotificationRow): string {
  return row.actor?.name ?? "Someone";
}

function courseTitle(row: NotificationRow): string {
  return row.course?.title ?? "your course";
}

/** The course page, or the Team page for a Team Licence. */
function refundDecisionLink(row: NotificationRow): string {
  if (row.notification.teamLicenceId !== null) return "/team";
  return row.course ? `/courses/${row.course.slug}` : "/courses";
}
