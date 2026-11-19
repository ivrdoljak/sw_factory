import { describe, it, expect, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { NotificationEventKind } from "~/db/schema";
import { countUnread, listNotifications } from "./notifications.server";
import { postLessonCommentAndNotify } from "./comments.server";

type TestDb = ReturnType<typeof createTestDb>;

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lessonId: number;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
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

describe("posting a question on a lesson", () => {
  it("notifies the course's Instructor", () => {
    const question = postLessonCommentAndNotify(
      db,
      base.user.id,
      lessonId,
      null,
      "How do closures work?"
    );

    expect(listNotifications(db, base.instructor.id)).toMatchObject([
      {
        kind: NotificationEventKind.NewQuestion,
        title: "Test User asked a question on Closures",
        link: `/courses/test-course/lessons/${lessonId}#comment-${question.id}`,
        detail: "How do closures work?",
      },
    ]);
  });

  it("raises no Notification when the question is rejected", () => {
    expect(() =>
      postLessonCommentAndNotify(db, base.user.id, lessonId, null, "   ")
    ).toThrow("Comment cannot be empty");

    expect(listNotifications(db, base.instructor.id)).toEqual([]);
    expect(countUnread(db, base.instructor.id)).toBe(0);
  });
});

describe("replying in a lesson thread", () => {
  function addStudent(name: string) {
    return db
      .insert(schema.users)
      .values({
        name,
        email: `${name.toLowerCase().replaceAll(" ", ".")}@example.com`,
        role: schema.UserRole.Student,
      })
      .returning()
      .get();
  }

  it("notifies the question's author", () => {
    const question = postLessonCommentAndNotify(
      db,
      base.user.id,
      lessonId,
      null,
      "How do closures work?"
    );

    const reply = postLessonCommentAndNotify(
      db,
      base.instructor.id,
      lessonId,
      question.id,
      "A closure keeps its scope."
    );

    expect(listNotifications(db, base.user.id)).toMatchObject([
      {
        kind: NotificationEventKind.NewReply,
        title: "Test Instructor replied on Closures",
        link: `/courses/test-course/lessons/${lessonId}#comment-${reply.id}`,
        detail: "A closure keeps its scope.",
      },
    ]);
  });

  it("posts no reply when its Notifications can't be written", () => {
    const sam = addStudent("Sam Student");
    const question = postLessonCommentAndNotify(
      db,
      base.user.id,
      lessonId,
      null,
      "How do closures work?"
    );

    // Make notify() fail inside the transaction: the database refuses to
    // store any Notification.
    db.run(
      sql`CREATE TRIGGER notifications_unavailable BEFORE INSERT ON notifications
          BEGIN SELECT RAISE(ABORT, 'Notifications are unavailable'); END`
    );
    expect(() =>
      postLessonCommentAndNotify(
        db,
        sam.id,
        lessonId,
        question.id,
        "Same question here."
      )
    ).toThrow("Notifications are unavailable");
    db.run(sql`DROP TRIGGER notifications_unavailable`);

    // Had Sam's reply survived, Sam would now be in the thread and notified,
    // and the question's author would have a Notification for it.
    postLessonCommentAndNotify(
      db,
      base.instructor.id,
      lessonId,
      question.id,
      "A closure keeps its scope."
    );

    expect(listNotifications(db, sam.id)).toEqual([]);
    expect(countUnread(db, sam.id)).toBe(0);
    expect(listNotifications(db, base.user.id)).toMatchObject([
      { title: "Test Instructor replied on Closures" },
    ]);
  });
});
