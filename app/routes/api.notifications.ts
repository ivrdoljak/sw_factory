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
} from "~/lib/notifications.server";
import {
  decodeNotificationPosition,
  MarkIntent,
  NOTIFICATION_FILTERS,
} from "~/lib/notifications";
import { parseFormData } from "~/lib/validation";

// The one endpoint for the current user's Notifications (spec #18). Later
// Notification work extends it rather than adding another.
//
// - GET: the unread count and a page of the list, newest first. Filter,
//   cursor and "newer than" go in the search params, parsed by `listSchema`;
//   `only=unread-count` leaves the list out.
// - POST: the mark actions, one `intent` each in `actionSchema`. Posting from a
//   fetcher revalidates the layout loader, so the sidebar badge refreshes.

/** A Notification's (raisedAt, id) position, as `encodeNotificationPosition` wrote it. */
const position = z
  .string()
  .transform(decodeNotificationPosition)
  .pipe(
    z.object({
      raisedAt: z.string().datetime(),
      id: z.number().int().positive(),
    })
  );

const listSchema = z.object({
  filter: z.enum(NOTIFICATION_FILTERS).default("all"),
  // "Load older": only Notifications older than the oldest one shown.
  before: position.optional(),
  // The polling check: just the unread count, for the badge.
  only: z.literal("unread-count").optional(),
  // The polling check with the drawer open: only Notifications raised after
  // the newest one shown.
  newerThan: position.optional(),
});

export async function loader({ request, url }: Route.LoaderArgs) {
  const userId = await requireUserId(request);

  const parsed = listSchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) throw data("Invalid Notifications query", { status: 400 });

  const query = parsed.data;
  const unreadCount = countUnread(db, userId);
  if (query.only === "unread-count") return { unreadCount };

  const page = listNotificationPage(db, userId, {
    filter: query.filter,
    before: query.before,
    newerThan: query.newerThan,
  });

  // The filter is echoed so the drawer can drop a page meant for another one.
  return { ...page, filter: query.filter, unreadCount };
}

const notificationId = z.coerce.number().int().positive();

const actionSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal(MarkIntent.Read), notificationId }),
  z.object({ intent: z.literal(MarkIntent.Unread), notificationId }),
  z.object({ intent: z.literal(MarkIntent.AllRead) }),
]);

export async function action({ request }: Route.ActionArgs) {
  const userId = await requireUserId(request);

  const parsed = parseFormData(await request.formData(), actionSchema);
  if (!parsed.success) throw data("Invalid Notification action", { status: 400 });

  switch (parsed.data.intent) {
    case MarkIntent.Read: {
      if (!markRead(db, userId, parsed.data.notificationId)) {
        throw data("Notification not found", { status: 404 });
      }
      return { ok: true };
    }
    case MarkIntent.Unread: {
      if (!markUnread(db, userId, parsed.data.notificationId)) {
        throw data("Notification not found", { status: 404 });
      }
      return { ok: true };
    }
    case MarkIntent.AllRead: {
      markAllRead(db, userId);
      return { ok: true };
    }
  }
}
