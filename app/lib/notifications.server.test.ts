import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { NotificationEventKind, RefundStatus, UserRole } from "~/db/schema";
import {
  countUnread,
  listNotifications,
  markRead,
  notify,
} from "./notifications.server";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let platformAdmin: typeof schema.users.$inferSelect;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  platformAdmin = db
    .insert(schema.users)
    .values({ name: "Pat Admin", email: "pat@example.com", role: UserRole.Admin })
    .returning()
    .get();
});

/** An Individual Purchase with a Refund Request a Platform Admin has declined. */
function declinedRefundRequest(buyerId: number) {
  const purchase = db
    .insert(schema.purchases)
    .values({ userId: buyerId, courseId: base.course.id, amountPaid: 7900 })
    .returning()
    .get();
  return db
    .insert(schema.refunds)
    .values({
      purchaseId: purchase.id,
      status: RefundStatus.Declined,
      reason: "Not for me.",
      decisionNote: "Past half way.",
    })
    .returning()
    .get().id;
}

function declined(refundRequestId: number, actorId: number, raisedAt = NOW) {
  return {
    kind: NotificationEventKind.RefundRequestDeclined,
    actorId,
    refundRequestId,
    raisedAt,
  } as const;
}

describe("notify", () => {
  it("raises nothing when the change it belongs to rolls back", () => {
    const refundRequestId = declinedRefundRequest(base.user.id);

    expect(() =>
      db.transaction((tx) => {
        notify(tx, declined(refundRequestId, platformAdmin.id));
        throw new Error("The decision failed.");
      })
    ).toThrow("The decision failed.");

    expect(listNotifications(db, base.user.id)).toEqual([]);
    expect(countUnread(db, base.user.id)).toBe(0);
  });

  it("never notifies the person who acted", () => {
    const refundRequestId = declinedRefundRequest(platformAdmin.id);

    db.transaction((tx) => {
      notify(tx, declined(refundRequestId, platformAdmin.id));
    });

    expect(listNotifications(db, platformAdmin.id)).toEqual([]);
    expect(countUnread(db, platformAdmin.id)).toBe(0);
  });
});

describe("a recipient's Notifications", () => {
  it("are listed newest first", () => {
    const older = declinedRefundRequest(base.user.id);
    const newer = declinedRefundRequest(base.user.id);
    const yesterday = new Date(NOW);
    yesterday.setDate(yesterday.getDate() - 1);

    db.transaction((tx) => {
      notify(tx, declined(newer, platformAdmin.id, NOW));
      notify(tx, declined(older, platformAdmin.id, yesterday));
    });

    expect(listNotifications(db, base.user.id)).toMatchObject([
      { raisedAt: NOW.toISOString() },
      { raisedAt: yesterday.toISOString() },
    ]);
    expect(countUnread(db, base.user.id)).toBe(2);
  });
});

describe("marking a Notification read", () => {
  function twoDeclinedRefundRequests() {
    const first = declinedRefundRequest(base.user.id);
    const second = declinedRefundRequest(base.user.id);
    db.transaction((tx) => {
      notify(tx, declined(first, platformAdmin.id));
      notify(tx, declined(second, platformAdmin.id));
    });
    const [newest, other] = listNotifications(db, base.user.id);
    return { newest, other };
  }

  it("marks only that Notification read and drops the unread count by one", () => {
    const { newest, other } = twoDeclinedRefundRequests();

    expect(markRead(db, base.user.id, newest.id)).toBe(true);

    expect(listNotifications(db, base.user.id)).toMatchObject([
      { id: newest.id, read: true },
      { id: other.id, read: false },
    ]);
    expect(countUnread(db, base.user.id)).toBe(1);
  });

  it("leaves an already read Notification read", () => {
    const { newest } = twoDeclinedRefundRequests();
    markRead(db, base.user.id, newest.id);

    expect(markRead(db, base.user.id, newest.id)).toBe(true);

    expect(listNotifications(db, base.user.id)[0]).toMatchObject({
      id: newest.id,
      read: true,
    });
    expect(countUnread(db, base.user.id)).toBe(1);
  });

  it("can't mark someone else's Notification read", () => {
    const { newest } = twoDeclinedRefundRequests();

    expect(markRead(db, base.instructor.id, newest.id)).toBe(false);

    expect(listNotifications(db, base.user.id)[0]).toMatchObject({
      id: newest.id,
      read: false,
    });
    expect(countUnread(db, base.user.id)).toBe(2);
  });
});

function hoursBefore(hours: number) {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000);
}

describe("the drawer's list", () => {
  it("is the newest 20 Notifications, newest first", () => {
    // Raised out of order, so the newest are not simply the last stored.
    const hoursAgo = [
      3, 24, 0, 25, 7, 12, 1, 30, 18, 5, 22, 9, 2, 27, 14, 6, 20, 4, 11, 29,
      16, 8, 26, 10, 13,
    ];
    db.transaction((tx) => {
      for (const hours of hoursAgo) {
        const refundRequestId = declinedRefundRequest(base.user.id);
        notify(tx, declined(refundRequestId, platformAdmin.id, hoursBefore(hours)));
      }
    });

    const listed = listNotifications(db, base.user.id);

    // The five oldest (25 to 30 hours ago) are left out.
    const newestTwenty = [
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 22, 24,
    ].map((hours) => hoursBefore(hours).toISOString());
    expect(listed.map((n) => n.raisedAt)).toEqual(newestTwenty);
    expect(countUnread(db, base.user.id)).toBe(25);
  });
});
