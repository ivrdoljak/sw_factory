import { and, count, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import {
  comments,
  coupons,
  courses,
  lessons,
  modules,
  notifications,
  purchases,
  refunds,
  users,
  NotificationEventKind,
  RefundStatus,
  UserRole,
} from "~/db/schema";
import type { Queryable, Tx } from "~/db/types";
import { commentExcerpt } from "~/lib/comment-markdown.server";
import { commentAnchorId } from "~/lib/comments";

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

type NewQuestionEvent = {
  kind: NotificationEventKind.NewQuestion;
  /** Whoever asked: the author of the top-level comment. */
  actorId: number;
  commentId: number;
  raisedAt: Date;
};

type NewReplyEvent = {
  kind: NotificationEventKind.NewReply;
  /** Whoever replied: the author of the reply. */
  actorId: number;
  /** The reply, not the question it answers. */
  commentId: number;
  raisedAt: Date;
};

/** A Notification Event with its facts: which kind, who acted, and the ids involved. */
export type NotificationEvent =
  | RefundDecisionEvent
  | RefundRequestRaisedEvent
  | SeatClaimedEvent
  | NewQuestionEvent
  | NewReplyEvent;

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
    case NotificationEventKind.NewQuestion:
      return newQuestionDelivery(tx, event);
    case NotificationEventKind.NewReply:
      return newReplyDelivery(tx, event);
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

/** A question on a lesson goes to the course's Instructor. */
function newQuestionDelivery(tx: Tx, event: NewQuestionEvent): Delivery {
  const found = tx
    .select({
      lessonId: lessons.id,
      courseId: courses.id,
      instructorId: courses.instructorId,
    })
    .from(comments)
    .innerJoin(lessons, eq(comments.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(comments.id, event.commentId))
    .get();

  if (!found) return NOBODY;

  return {
    recipientIds: [found.instructorId],
    references: {
      courseId: found.courseId,
      lessonId: found.lessonId,
      commentId: event.commentId,
    },
  };
}

/**
 * A reply goes to everyone who has posted in its thread: the question's author
 * and every replier. Deleted comments still count their authors as having
 * posted. `notify` drops the replier and anyone listed twice.
 */
function newReplyDelivery(tx: Tx, event: NewReplyEvent): Delivery {
  const found = tx
    .select({
      questionId: comments.parentId,
      lessonId: lessons.id,
      courseId: courses.id,
    })
    .from(comments)
    .innerJoin(lessons, eq(comments.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(comments.id, event.commentId))
    .get();

  if (!found || found.questionId === null) return NOBODY;

  const posters = tx
    .select({ authorId: comments.userId })
    .from(comments)
    .where(
      or(
        eq(comments.id, found.questionId),
        eq(comments.parentId, found.questionId)
      )
    )
    .all();

  return {
    recipientIds: posters.map((poster) => poster.authorId),
    references: {
      courseId: found.courseId,
      lessonId: found.lessonId,
      commentId: event.commentId,
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
      lesson: { title: lessons.title },
      comment: { body: comments.body, deletedAt: comments.deletedAt },
      refundRequest: {
        status: refunds.status,
        decisionNote: refunds.decisionNote,
      },
    })
    .from(notifications)
    .leftJoin(actors, eq(notifications.actorId, actors.id))
    .leftJoin(courses, eq(notifications.courseId, courses.id))
    .leftJoin(lessons, eq(notifications.lessonId, lessons.id))
    .leftJoin(comments, eq(notifications.commentId, comments.id))
    .leftJoin(refunds, eq(notifications.refundRequestId, refunds.id));
}

type NotificationRow = ReturnType<
  ReturnType<typeof selectNotifications>["all"]
>[number];

/** How many Notifications the drawer loads at a time. */
export const NOTIFICATIONS_PAGE_SIZE = 20;

/** The drawer's filters: every Notification, or only the unread ones. */
export type NotificationFilter = "all" | "unread";

/**
 * Where a Notification sits in the list: the (raisedAt, id) pair it's sorted
 * by. Not the id alone, since `raisedAt` comes from the event and doesn't
 * follow insertion order.
 */
export type NotificationPosition = Pick<NotificationForDisplay, "raisedAt" | "id">;

/** Which of the recipient's Notifications to list. */
export type NotificationListQuery = {
  limit?: number;
  /** "all" unless given. */
  filter?: NotificationFilter;
  /** Only Notifications older than this one: "Load older" passes the oldest shown. */
  before?: NotificationPosition;
  /**
   * Only Notifications raised after this one: the newest one shown, for the
   * polling check that adds arrivals to the top of an open drawer.
   */
  newerThan?: NotificationPosition;
};

/** One page of the drawer's list, and whether older Notifications exist past it. */
export type NotificationPage = {
  notifications: NotificationForDisplay[];
  hasOlder: boolean;
};

/** The recipient's Notifications, newest first: one page of the drawer. */
export function listNotifications(
  db: Queryable,
  recipientId: number,
  query: NotificationListQuery = {}
): NotificationForDisplay[] {
  return listNotificationPage(db, recipientId, query).notifications;
}

/**
 * A page of the recipient's Notifications, newest first, saying whether older
 * ones exist past it so the drawer knows to offer "Load older".
 */
export function listNotificationPage(
  db: Queryable,
  recipientId: number,
  {
    limit = NOTIFICATIONS_PAGE_SIZE,
    filter = "all",
    before,
    newerThan,
  }: NotificationListQuery = {}
): NotificationPage {
  const rows = selectNotifications(db)
    .where(
      and(
        eq(notifications.recipientId, recipientId),
        filter === "unread" ? isNull(notifications.readAt) : undefined,
        before && sortsBelow(before),
        newerThan && sortsAbove(newerThan)
      )
    )
    .orderBy(desc(notifications.raisedAt), desc(notifications.id))
    // One more than the page, to tell whether older ones exist. Decided on the
    // rows, since rendering may leave some out.
    .limit(limit + 1)
    .all();

  return {
    notifications: rows.slice(0, limit).flatMap((row) => {
      const rendered = render(row);
      return rendered ? [rendered] : [];
    }),
    hasOlder: rows.length > limit,
  };
}

/** Raised earlier than the given position, or at the same time and stored earlier. */
function sortsBelow({ raisedAt, id }: NotificationPosition) {
  return or(
    lt(notifications.raisedAt, raisedAt),
    and(eq(notifications.raisedAt, raisedAt), lt(notifications.id, id))
  );
}

/** Raised later than the given position, or at the same time and stored later. */
function sortsAbove({ raisedAt, id }: NotificationPosition) {
  return or(
    gt(notifications.raisedAt, raisedAt),
    and(eq(notifications.raisedAt, raisedAt), gt(notifications.id, id))
  );
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

/**
 * Marks one of the recipient's Notifications unread again, to keep it as a
 * reminder. Returns false when the recipient has no Notification with that id.
 */
export function markUnread(
  db: Queryable,
  recipientId: number,
  notificationId: number
): boolean {
  const result = db
    .update(notifications)
    .set({ readAt: null })
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.recipientId, recipientId)
      )
    )
    .run();

  return result.changes > 0;
}

/**
 * Marks every unread Notification of the recipient read, whether or not the
 * drawer has loaded it. Ones already read keep the time they were first read.
 */
export function markAllRead(
  db: Queryable,
  recipientId: number,
  at: Date = new Date()
): void {
  db.update(notifications)
    .set({ readAt: at.toISOString() })
    .where(
      and(
        eq(notifications.recipientId, recipientId),
        isNull(notifications.readAt)
      )
    )
    .run();
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
    case NotificationEventKind.NewQuestion:
      return renderNewQuestion(row);
    case NotificationEventKind.NewReply:
      return renderNewReply(row);
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

function renderNewQuestion(row: NotificationRow): Rendered {
  return {
    title: `${actorName(row)} asked a question on ${lessonTitle(row)}`,
    link: commentLink(row),
    detail: commentDetail(row),
    refundStatus: null,
  };
}

function renderNewReply(row: NotificationRow): Rendered {
  return {
    title: `${actorName(row)} replied on ${lessonTitle(row)}`,
    link: commentLink(row),
    detail: commentDetail(row),
    refundStatus: null,
  };
}

/**
 * The inline detail for a Notification about a comment (a question or a
 * reply): the comment as it reads now, as a short plain-text excerpt.
 */
function commentDetail(row: NotificationRow): string {
  if (!row.comment || row.comment.deletedAt !== null) {
    return "This comment was deleted.";
  }
  return commentExcerpt(row.comment.body);
}

function lessonTitle(row: NotificationRow): string {
  return row.lesson?.title ?? "a lesson";
}

/** The lesson page, at the comment's anchor. */
function commentLink(row: NotificationRow): string {
  const { lessonId, commentId } = row.notification;
  if (!row.course || lessonId === null) return "/courses";
  const lessonPage = `/courses/${row.course.slug}/lessons/${lessonId}`;
  return commentId === null
    ? lessonPage
    : `${lessonPage}#${commentAnchorId(commentId)}`;
}
