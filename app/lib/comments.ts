export const MIN_COMMENT_LENGTH = 1;
export const MAX_COMMENT_LENGTH = 5000;

/**
 * The element id of a comment on the lesson page, so a link can end in
 * `#${commentAnchorId(id)}` and land on that comment.
 */
export function commentAnchorId(commentId: number): string {
  return `comment-${commentId}`;
}
