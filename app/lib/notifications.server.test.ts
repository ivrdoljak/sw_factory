import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { NotificationEventKind, RefundStatus, UserRole } from "~/db/schema";
import { eq } from "drizzle-orm";
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

describe("a new question", () => {
  let lessonId: number;

  beforeEach(() => {
    const moduleId = db
      .insert(schema.modules)
      .values({ courseId: base.course.id, title: "Basics", position: 1 })
      .returning()
      .get().id;
    lessonId = db
      .insert(schema.lessons)
      .values({ moduleId, title: "Closures", position: 1 })
      .returning()
      .get().id;
  });

  /** Posts a top-level comment on the lesson and raises its Notification Event. */
  function ask(authorId: number, body = "How do closures work?") {
    return db.transaction((tx) => {
      const comment = tx
        .insert(schema.comments)
        .values({ userId: authorId, lessonId, parentId: null, body })
        .returning()
        .get();
      notify(tx, {
        kind: NotificationEventKind.NewQuestion,
        actorId: authorId,
        commentId: comment.id,
        raisedAt: NOW,
      });
      return comment.id;
    });
  }

  it("notifies the course's Instructor, naming the Student and the lesson", () => {
    ask(base.user.id);

    expect(listNotifications(db, base.instructor.id)).toMatchObject([
      {
        kind: NotificationEventKind.NewQuestion,
        title: "Test User asked a question on Closures",
        read: false,
      },
    ]);
    expect(countUnread(db, base.instructor.id)).toBe(1);
    expect(listNotifications(db, base.user.id)).toEqual([]);
  });

  it("notifies nobody when the Instructor asks on their own lesson", () => {
    ask(base.instructor.id);

    expect(listNotifications(db, base.instructor.id)).toEqual([]);
    expect(countUnread(db, base.instructor.id)).toBe(0);
  });

  it("shows the lesson's current title after a rename", () => {
    ask(base.user.id);
    db.update(schema.lessons)
      .set({ title: "Closures, again?" })
      .where(eq(schema.lessons.id, lessonId))
      .run();

    expect(listNotifications(db, base.instructor.id)).toMatchObject([
      { title: "Test User asked a question on Closures, again?" },
    ]);
  });

  it("links to the question on the lesson page", () => {
    const commentId = ask(base.user.id);

    expect(listNotifications(db, base.instructor.id)).toMatchObject([
      { link: `/courses/test-course/lessons/${lessonId}#comment-${commentId}` },
    ]);
  });

  it("shows the question as plain text, markdown stripped", () => {
    ask(
      base.user.id,
      [
        "## Why `this` & <b>scope</b>?",
        "",
        "Is **this** the [right docs](https://example.com)? It's _odd_ &amp; ![a cat](cat.png)",
        "",
        "- first",
        "- second",
        "",
        "```js",
        "const a = 1 < 2;",
        "```",
      ].join("\n")
    );

    expect(listNotifications(db, base.instructor.id)).toMatchObject([
      {
        detail:
          "Why this & scope? Is this the right docs? It's odd & a cat first second const a = 1 < 2;",
      },
    ]);
  });

  it("cuts a long question to about 140 characters", () => {
    const words = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    ask(base.user.id, words);

    const [notification] = listNotifications(db, base.instructor.id);
    const detail = notification?.detail ?? "";
    expect(detail.length).toBeLessThanOrEqual(141);
    expect(detail.length).toBeGreaterThan(120);
    expect(detail.startsWith("word0 word1 word2")).toBe(true);
    expect(detail.endsWith("…")).toBe(true);
  });

  it("shows the question as edited", () => {
    const commentId = ask(base.user.id, "How do closures work?");
    db.update(schema.comments)
      .set({ body: "How do **closures** capture variables?", editedAt: NOW.toISOString() })
      .where(eq(schema.comments.id, commentId))
      .run();

    expect(listNotifications(db, base.instructor.id)).toMatchObject([
      { detail: "How do closures capture variables?" },
    ]);
  });

  it("says the question was deleted, still linking to its spot in the thread", () => {
    const commentId = ask(base.user.id);
    db.update(schema.comments)
      .set({ deletedAt: NOW.toISOString() })
      .where(eq(schema.comments.id, commentId))
      .run();

    expect(listNotifications(db, base.instructor.id)).toMatchObject([
      {
        title: "Test User asked a question on Closures",
        link: `/courses/test-course/lessons/${lessonId}#comment-${commentId}`,
        detail: "This comment was deleted.",
      },
    ]);
  });
});
