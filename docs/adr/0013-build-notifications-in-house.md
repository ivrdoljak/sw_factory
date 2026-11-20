# Build Notifications in-house rather than buying a notification service

Cadence stores and delivers its in-app Notifications itself, in its own SQLite database, and doesn't use a hosted service like Knock, Novu or Courier. Three things make this the cheaper option:

- The list of Notification Events is small.
- The drawer is our own design, so a vendor's prebuilt inbox would go unused.
- Cadence runs as one process (ADR 0006), so a single table, an unread count in the layout loader, and polling or server-sent events cover delivery.

Building it also keeps Student names and course activity in our own database, and lets tests read Notifications as plain rows. Every Notification Event enters through one server-side `notify()` seam. It owns the recipient rules and the "never notify someone about their own action" rule, and it writes in the same transaction as the change that raised the event. That seam is where email, or a vendor, would plug in later.

## Considered Options

- **Novu.** The best vendor fit: EU data residency on Free, prebuilt preferences and digest, and an MIT self-host. Rejected because:
  - Free rejects triggers with HTTP 402 after 10k runs a month.
  - Self-hosting needs MongoDB, Redis, S3 and four services alongside one SQLite process.
- **Knock or Courier.** Polished, but rejected for data residency: Knock has no EU region yet, and Courier has one only on paid plans.
- **Others.** MagicBell and SuprSend charge for each channel separately, and MagicBell's free tier is only 1k a month.

The comparison, as researched on 2026-11-18, is on the `research/notification-services` branch: `docs/research/in-app-notification-services.md`.

## Consequences

Anything a vendor would have bundled is ours to build if we ever want it: preferences, digests or batching, retention cleanup, retries, and extra channels. Existing transactional emails still go through `sendEmail` at their call sites; moving them behind `notify()` is a later choice, not a requirement.
