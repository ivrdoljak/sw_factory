import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
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

describe("a claimed Seat", () => {
  function addPerson(name: string) {
    return db
      .insert(schema.users)
      .values({
        name,
        email: `${name.toLowerCase().replaceAll(" ", ".")}@example.com`,
        role: UserRole.Student,
      })
      .returning()
      .get();
  }

  /** A Team Licence on the base course. Returns its Seats' ids. */
  function buySeats(teamAdminId: number, seats = 2) {
    const team = db.insert(schema.teams).values({}).returning().get();
    const teamLicence = db
      .insert(schema.purchases)
      .values({
        userId: teamAdminId,
        courseId: base.course.id,
        amountPaid: 7900 * seats,
      })
      .returning()
      .get();
    return Array.from(
      { length: seats },
      (_, i) =>
        db
          .insert(schema.coupons)
          .values({
            teamId: team.id,
            courseId: base.course.id,
            code: `SEAT-${teamLicence.id}-${i}`,
            purchaseId: teamLicence.id,
          })
          .returning()
          .get().id
    );
  }

  function seatClaimed(seatId: number, studentId: number) {
    return {
      kind: NotificationEventKind.SeatClaimed,
      actorId: studentId,
      seatId,
      raisedAt: NOW,
    } as const;
  }

  it("notifies the Team Admin who bought the Team Licence, linking to the Team page", () => {
    const teamAdmin = addPerson("Bossy McBossface");
    const [seatId] = buySeats(teamAdmin.id);

    db.transaction((tx) => {
      notify(tx, seatClaimed(seatId, base.user.id));
    });

    expect(listNotifications(db, teamAdmin.id)).toEqual([
      {
        id: expect.any(Number),
        kind: NotificationEventKind.SeatClaimed,
        title: "Test User claimed a Seat on Test Course",
        link: "/team",
        detail: null,
        refundStatus: null,
        raisedAt: NOW.toISOString(),
        read: false,
      },
    ]);
    expect(countUnread(db, teamAdmin.id)).toBe(1);
  });

  it("notifies only that Team Admin, not the Student who claimed it", () => {
    const teamAdmin = addPerson("Bossy McBossface");
    const otherTeamAdmin = addPerson("Other Boss");
    const [seatId] = buySeats(teamAdmin.id);
    buySeats(otherTeamAdmin.id);

    db.transaction((tx) => {
      notify(tx, seatClaimed(seatId, base.user.id));
    });

    expect(listNotifications(db, base.user.id)).toEqual([]);
    expect(listNotifications(db, otherTeamAdmin.id)).toEqual([]);
    expect(countUnread(db, otherTeamAdmin.id)).toBe(0);
  });

  it("doesn't notify a Team Admin who claims a Seat on their own Team Licence", () => {
    const teamAdmin = addPerson("Bossy McBossface");
    const [seatId] = buySeats(teamAdmin.id);

    db.transaction((tx) => {
      notify(tx, seatClaimed(seatId, teamAdmin.id));
    });

    expect(listNotifications(db, teamAdmin.id)).toEqual([]);
    expect(countUnread(db, teamAdmin.id)).toBe(0);
  });

  it("shows the course's current title after a rename", () => {
    const teamAdmin = addPerson("Bossy McBossface");
    const [seatId] = buySeats(teamAdmin.id);

    db.transaction((tx) => {
      notify(tx, seatClaimed(seatId, base.user.id));
    });
    db.update(schema.courses)
      .set({ title: "What is TypeScript?" })
      .where(eq(schema.courses.id, base.course.id))
      .run();

    expect(listNotifications(db, teamAdmin.id)).toMatchObject([
      { title: "Test User claimed a Seat on What is TypeScript?" },
    ]);
  });
});
