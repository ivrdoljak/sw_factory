// ─── Notifications: what the drawer and the endpoint share ───
// The notifications drawer (client) and api.notifications (server) both import
// this file, so it must never import the database (~/db) or a .server module.
// The Notifications themselves live in ~/lib/notifications.server.

/** The one endpoint for the current user's Notifications (app/routes/api.notifications.ts). */
export const NOTIFICATIONS_ENDPOINT = "/api/notifications";

/** How many Notifications the drawer loads at a time: the most one request returns. */
export const NOTIFICATIONS_PAGE_SIZE = 20;

/** The drawer's filters: every Notification, or only the unread ones. */
export const NOTIFICATION_FILTERS = ["all", "unread"] as const;

export type NotificationFilter = (typeof NOTIFICATION_FILTERS)[number];

/** The endpoint's POST intents, one per way of marking Notifications. */
export const MarkIntent = {
  Read: "mark-read",
  Unread: "mark-unread",
  AllRead: "mark-all-read",
} as const;

/**
 * Where a Notification sits in the list: the (raisedAt, id) pair it's sorted
 * by. Not the id alone, since `raisedAt` comes from the event and doesn't
 * follow insertion order.
 */
export type NotificationPosition = { raisedAt: string; id: number };

const POSITION_SEPARATOR = "~";

/** A position as one search param value, for "Load older" and the polling check. */
export function encodeNotificationPosition({
  raisedAt,
  id,
}: NotificationPosition): string {
  return `${raisedAt}${POSITION_SEPARATOR}${id}`;
}

/**
 * The position in a search param value, or null if it has no id. The parts
 * aren't validated here: the endpoint checks them with its schema.
 */
export function decodeNotificationPosition(
  value: string
): NotificationPosition | null {
  const separator = value.lastIndexOf(POSITION_SEPARATOR);
  if (separator === -1) return null;
  return {
    raisedAt: value.slice(0, separator),
    id: Number(value.slice(separator + 1)),
  };
}
