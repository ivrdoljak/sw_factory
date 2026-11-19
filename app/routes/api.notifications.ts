import { data } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/api.notifications";
import { db } from "~/db";
import { requireUserId } from "~/lib/access.server";
import {
  countUnread,
  listNotificationPage,
  markAllRead,
  markRead,
  markUnread,
  type NotificationPosition,
} from "~/lib/notifications.server";
import { parseFormData } from "~/lib/validation";

// The one endpoint for the current user's Notifications (spec #18). Later
// Notification work extends it rather than adding another.
//
// - GET: the unread count and a page of the list, newest first. Filter,
//   cursor and "newer than" go in the search params, parsed by `listSchema`;
//   `only=unread-count` leaves the list out.
// - POST: the mark actions, one `intent` each in `actionSchema`. Posting from a
//   fetcher revalidates the layout loader, so the sidebar badge refreshes.

const listSchema = z
  .object({
    filter: z.enum(["all", "unread"]).default("all"),
    // "Load older": the oldest Notification shown, as its (raisedAt, id) pair.
    beforeRaisedAt: z.string().datetime().optional(),
    beforeId: z.coerce.number().int().positive().optional(),
    // The polling check: just the unread count, for the badge.
    only: z.literal("unread-count").optional(),
    // The polling check with the drawer open: only Notifications raised after
    // the newest one shown, given as its (raisedAt, id) position.
    newerThanRaisedAt: z.string().datetime().optional(),
    newerThanId: z.coerce.number().int().positive().optional(),
  })
  .refine(
    (query) =>
      (query.beforeRaisedAt === undefined) === (query.beforeId === undefined),
    "beforeRaisedAt and beforeId go together"
  )
  .refine(
    (query) =>
      (query.newerThanRaisedAt === undefined) ===
      (query.newerThanId === undefined),
    "newerThanRaisedAt and newerThanId go together"
  );

function position(
  raisedAt: string | undefined,
  id: number | undefined
): NotificationPosition | undefined {
  return raisedAt !== undefined && id !== undefined ? { raisedAt, id } : undefined;
}

export async function loader({ request, url }: Route.LoaderArgs) {
  const userId = await requireUserId(request);

  const parsed = listSchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) throw data("Invalid Notifications query", { status: 400 });

  const query = parsed.data;
  const unreadCount = countUnread(db, userId);
  if (query.only === "unread-count") return { unreadCount };

  const page = listNotificationPage(db, userId, {
    filter: query.filter,
    before: position(query.beforeRaisedAt, query.beforeId),
    newerThan: position(query.newerThanRaisedAt, query.newerThanId),
  });

  // The filter is echoed so the drawer can drop a page meant for another one.
  return { ...page, filter: query.filter, unreadCount };
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
