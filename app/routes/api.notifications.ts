import { data } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/api.notifications";
import { db } from "~/db";
import { requireUserId } from "~/lib/access.server";
import {
  listNotificationPage,
  markAllRead,
  markRead,
  markUnread,
} from "~/lib/notifications.server";
import { parseFormData } from "~/lib/validation";

// The one endpoint for the current user's Notifications (spec #18). Later
// Notification work extends it rather than adding another.
//
// - GET: a page of the list, newest first. Filter, cursor and "newer than"
//   go in the search params, parsed by `listSchema`.
// - POST: the mark actions, one `intent` each in `actionSchema`. Posting from a
//   fetcher revalidates the layout loader, so the sidebar badge refreshes.

const listSchema = z
  .object({
    filter: z.enum(["all", "unread"]).default("all"),
    // "Load older": the oldest Notification shown, as its (raisedAt, id) pair.
    beforeRaisedAt: z.string().datetime().optional(),
    beforeId: z.coerce.number().int().positive().optional(),
  })
  .refine(
    (query) =>
      (query.beforeRaisedAt === undefined) === (query.beforeId === undefined),
    "A cursor needs both beforeRaisedAt and beforeId"
  );

export async function loader({ request, url }: Route.LoaderArgs) {
  const userId = await requireUserId(request);

  const parsed = listSchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) throw data("Invalid Notifications query", { status: 400 });

  const { filter, beforeRaisedAt, beforeId } = parsed.data;
  const before =
    beforeRaisedAt !== undefined && beforeId !== undefined
      ? { raisedAt: beforeRaisedAt, id: beforeId }
      : undefined;

  const page = listNotificationPage(db, userId, { filter, before });
  // The filter is echoed so the drawer can drop a page meant for another one.
  return { ...page, filter };
}

const notificationId = z.coerce.number().int().positive();

const actionSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("mark-read"), notificationId }),
  z.object({ intent: z.literal("mark-unread"), notificationId }),
  z.object({ intent: z.literal("mark-all-read") }),
]);

export async function action({ request }: Route.ActionArgs) {
  const userId = await requireUserId(request);

  const parsed = parseFormData(await request.formData(), actionSchema);
  if (!parsed.success) throw data("Invalid Notification action", { status: 400 });

  switch (parsed.data.intent) {
    case "mark-read": {
      if (!markRead(db, userId, parsed.data.notificationId)) {
        throw data("Notification not found", { status: 404 });
      }
      return { ok: true };
    }
    case "mark-unread": {
      if (!markUnread(db, userId, parsed.data.notificationId)) {
        throw data("Notification not found", { status: 404 });
      }
      return { ok: true };
    }
    case "mark-all-read": {
      markAllRead(db, userId);
      return { ok: true };
    }
  }
}
