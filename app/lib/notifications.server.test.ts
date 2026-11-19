import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { NotificationEventKind, RefundStatus, UserRole } from "~/db/schema";
import { countUnread, listNotifications, notify } from "./notifications.server";

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
