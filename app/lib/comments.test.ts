import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { postLessonComment } from "./comments";

type TestDb = ReturnType<typeof createTestDb>;

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let moduleId: number;
let lessonId: number;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);

  moduleId = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get().id;

  lessonId = addLesson("Lesson 1", 1);
});

function addLesson(title: string, position: number) {
  return db
    .insert(schema.lessons)
    .values({ moduleId, title, position })
    .returning()
    .get().id;
}

describe("postLessonComment", () => {
  it("a Student asks a question on a lesson, trimmed", () => {
    const question = postLessonComment(
      db,
      base.user.id,
      lessonId,
      null,
      "  How do closures work?  "
    );

    expect(question).toMatchObject({
      userId: base.user.id,
      lessonId,
      parentId: null,
      body: "How do closures work?",
    });
  });

  it("rejects a comment that is only whitespace", () => {
    expect(() =>
      postLessonComment(db, base.user.id, lessonId, null, "   \n ")
    ).toThrow("Comment cannot be empty");
  });

  it("accepts a comment of exactly 5000 characters but not 5001", () => {
    expect(
      postLessonComment(db, base.user.id, lessonId, null, "a".repeat(5000)).body
    ).toHaveLength(5000);

    expect(() =>
      postLessonComment(db, base.user.id, lessonId, null, "a".repeat(5001))
    ).toThrow("Comment must be 5000 characters or fewer");
  });

  it("rejects a comment on a lesson that does not exist", () => {
    expect(() =>
      postLessonComment(db, base.user.id, lessonId + 999, null, "Hello?")
    ).toThrow("Lesson not found");
  });

  it("the Instructor replies to a Student's question", () => {
    const question = postLessonComment(
      db,
      base.user.id,
      lessonId,
      null,
      "Why?"
    );

    const reply = postLessonComment(
      db,
      base.instructor.id,
      lessonId,
      question.id,
      "Because."
    );

    expect(reply).toMatchObject({
      userId: base.instructor.id,
      lessonId,
      parentId: question.id,
      body: "Because.",
    });
  });

  it("rejects a reply to a comment that does not exist", () => {
    expect(() =>
      postLessonComment(db, base.user.id, lessonId, 999, "Me too")
    ).toThrow("Parent comment not found");
  });

  it("rejects a reply to a question on a different lesson", () => {
    const otherLessonId = addLesson("Lesson 2", 2);
    const question = postLessonComment(
      db,
      base.user.id,
      otherLessonId,
      null,
      "Why?"
    );

    expect(() =>
      postLessonComment(db, base.user.id, lessonId, question.id, "Me too")
    ).toThrow("Parent comment belongs to a different lesson");
  });

  it("keeps replies one level deep", () => {
    const question = postLessonComment(
      db,
      base.user.id,
      lessonId,
      null,
      "Why?"
    );
    const reply = postLessonComment(
      db,
      base.instructor.id,
      lessonId,
      question.id,
      "Because."
    );

    expect(() =>
      postLessonComment(db, base.user.id, lessonId, reply.id, "Thanks")
    ).toThrow("Replies can only be one level deep");
  });

  it("can run inside a caller's transaction, and is undone with it", () => {
    let questionId = 0;
    expect(() =>
      db.transaction((tx) => {
        questionId = postLessonComment(
          tx,
          base.user.id,
          lessonId,
          null,
          "Why?"
        ).id;
        throw new Error("the rest of the change failed");
      })
    ).toThrow("the rest of the change failed");

    expect(() =>
      postLessonComment(db, base.instructor.id, lessonId, questionId, "Hi")
    ).toThrow("Parent comment not found");
  });
});
