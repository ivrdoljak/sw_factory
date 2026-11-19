import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as schema from "~/db/schema";
import { comments, lessons } from "~/db/schema";

// ─── Comments ───
// Posting a comment on a lesson: a question (top-level) or a reply to one.
//
// Client components import the bounds below, so this file must never import
// the database itself (~/db): every function takes the database, or a
// transaction, first, so a caller can run it inside its own transaction and
// tests can hand in an in-memory one. Uses positional parameters (project
// convention).

export const MIN_COMMENT_LENGTH = 1;
export const MAX_COMMENT_LENGTH = 5000;

/**
 * The element id of a comment on the lesson page, so a link can end in
 * `#${commentAnchorId(id)}` and land on that comment.
 */
export function commentAnchorId(commentId: number): string {
  return `comment-${commentId}`;
}

type Db = BetterSQLite3Database<typeof schema>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Queryable = Db | Tx;

export type Comment = typeof comments.$inferSelect;

// Returns the body trimmed, or throws a message fit to show the person typing.
export function assertValidCommentBody(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length < MIN_COMMENT_LENGTH) {
    throw new Error("Comment cannot be empty");
  }
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    throw new Error(
      `Comment must be ${MAX_COMMENT_LENGTH} characters or fewer`
    );
  }
  return trimmed;
}

export function postLessonComment(
  db: Queryable,
  userId: number,
  lessonId: number,
  parentId: number | null,
  body: string
): Comment {
  const trimmed = assertValidCommentBody(body);

  const lesson = db
    .select({ id: lessons.id })
    .from(lessons)
    .where(eq(lessons.id, lessonId))
    .get();
  if (!lesson) {
    throw new Error("Lesson not found");
  }

  if (parentId !== null) {
    const parent = db
      .select()
      .from(comments)
      .where(eq(comments.id, parentId))
      .get();
    if (!parent) {
      throw new Error("Parent comment not found");
    }
    if (parent.lessonId !== lessonId) {
      throw new Error("Parent comment belongs to a different lesson");
    }
    if (parent.parentId !== null) {
      throw new Error("Replies can only be one level deep");
    }
  }

  return db
    .insert(comments)
    .values({ userId, lessonId, parentId, body: trimmed })
    .returning()
    .get();
}
