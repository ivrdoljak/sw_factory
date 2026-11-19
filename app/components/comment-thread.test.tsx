import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import { CommentThread, type RenderedComment } from "~/components/comment-thread";

function comment(
  id: number,
  overrides: Partial<RenderedComment> = {}
): RenderedComment {
  return {
    id,
    body: `Comment ${id}`,
    bodyHtml: `<p>Comment ${id}</p>`,
    createdAt: "2026-01-01T00:00:00.000Z",
    editedAt: null,
    deleted: false,
    author: {
      id: 100 + id,
      name: `Student ${id}`,
      avatarUrl: null,
      isInstructor: false,
      isAdmin: false,
    },
    replies: [],
    ...overrides,
  };
}

function renderLessonThread(comments: RenderedComment[]) {
  const Stub = createRoutesStub([
    {
      path: "/courses/:slug/lessons/:lessonId",
      Component: () => (
        <CommentThread
          comments={comments}
          currentUserId={null}
          canModerate={false}
          canPost
          instructorName="Ada Instructor"
        />
      ),
    },
  ]);

  return renderToStaticMarkup(
    <Stub initialEntries={["/courses/intro/lessons/7"]} />
  );
}

describe("lesson page comment anchors", () => {
  it("gives a top-level question an anchor from its id", () => {
    const html = renderLessonThread([comment(42)]);

    expect(html).toContain('id="comment-42"');
  });

  it("gives a reply inside a thread its own anchor", () => {
    const html = renderLessonThread([
      comment(42, { replies: [comment(43), comment(57)] }),
    ]);

    expect(html).toContain('id="comment-42"');
    expect(html).toContain('id="comment-43"');
    expect(html).toContain('id="comment-57"');
  });

  it("keeps the anchor of a deleted question still shown for its replies", () => {
    const html = renderLessonThread([
      comment(42, {
        deleted: true,
        body: "",
        bodyHtml: "",
        replies: [comment(43)],
      }),
    ]);

    expect(html).toContain("This comment was deleted.");
    expect(html).toContain('id="comment-42"');
    expect(html).toContain('id="comment-43"');
  });
});
