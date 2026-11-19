import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as schema from "~/db/schema";
import { NotificationEventKind } from "~/db/schema";
import { postLessonComment, type Comment } from "~/lib/comments";
import { notify } from "~/lib/notifications.server";

// ─── Posting comments, with their Notifications ───
// The one way a route posts a lesson comment. It lives apart from
// ~/lib/comments because client components import that file, and this one
// reaches the notifications module, which is server-only.

type Db = BetterSQLite3Database<typeof schema>;

/**
 * Posts a question (top-level) or a reply on a lesson and raises its
 * Notification Event, in one transaction, so neither exists without the other.
 * Throws the same validation errors as `postLessonComment`, with nothing
 * written.
 */
export function postLessonCommentAndNotify(
  db: Db,
  userId: number,
  lessonId: number,
  parentId: number | null,
  body: string
): Comment {
  return db.transaction((tx) => {
    const comment = postLessonComment(tx, userId, lessonId, parentId, body);

    notify(tx, {
      kind:
        comment.parentId === null
          ? NotificationEventKind.NewQuestion
          : NotificationEventKind.NewReply,
      actorId: userId,
      commentId: comment.id,
      raisedAt: new Date(comment.createdAt),
    });

    return comment;
  });
}
