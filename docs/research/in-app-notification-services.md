# Hosted in-app notification services vs building in-house

Research for the wayfinder ticket "What do hosted in-app notification services offer versus building in-house?" (ivrdoljak/sw_factory#11), part of the map "Wayfinder: In-app Notifications for Cadence" (#9).

- **Researched:** 2026-11-18. Prices and limits change often, so recheck the pricing pages before relying on them.
- **Sources:** vendor docs, pricing pages, official GitHub repos and the npm registry. Every claim links to its source.
- **Labels:** "unverified" means I found no primary source. "Inference" means the conclusion is mine, not a vendor's statement.
- **Scope:** this file collects facts for the build-or-buy decision. It does not make that decision.

## Cadence today, as the code shows it

The ticket brief says two things that the repo contradicts. This list follows the repo.

- **React Router version.** `package.json` pins `react-router`, `@react-router/node` and `@react-router/serve` at **8.3.0**, not v7. The app runs in framework mode with SSR (`react-router.config.ts`, `ssr: true`), on React 19.2.
- **Email.** Postmark already sends email. `app/lib/mailer.server.ts` uses `postmarkTransport` when `POSTMARK_SERVER_TOKEN` is set, and otherwise writes to `.outbox/` (`outboxTransport`). ADR `docs/adr/0010-refund-emails-go-to-the-server-log.md` still says there is no mail transport, so that ADR is stale.
- **Database.** SQLite through better-sqlite3 and Drizzle 0.45, in WAL mode (`app/db/index.ts`). There is one server process (ADR 0006), started with `react-router-serve`.
- **Recipients.**
  - `users.role` is `UserRole`: Student, Instructor or Admin. The Admin value is the Platform Admin.
  - Team Admins come from `teamMembers.role = Admin`.
  - The course's Instructor is `courses.instructorId`.
  - Refunds involve the buyer (`refunds.purchaseId → purchases.userId`) and the resolver (`refunds.resolvedByUserId`).

## Vendor status

| Vendor | Status (Nov 2026) | Kept? |
|---|---|---|
| Knock | Active. The changelog runs to 2026-11-10, and `@knocklabs/react` 0.15.1 was published Nov 2026 ([changelog](https://knock.app/changelog), npm). | Yes |
| Novu | Active. v3.20.0 shipped 2026-11-16, and the repo was pushed 2026-11-18 (GitHub API). The product is now split into "Novu Notify" (inbox and workflows) and "Novu Connect" (AI agents) ([novu.co](https://novu.co)). | Yes |
| Courier | Active. `@trycourier/courier-react` 9.3.5 was published Nov 2026 (npm). The legacy v7 `@trycourier/react-inbox` is deprecated. | Yes |
| MagicBell | Active. The v2 API was rewritten ([openapi.json](https://www.magicbell.com/docs/api/openapi.json)), `@magicbell/react` 1.14.0 shipped 2026-07, and the repo was pushed 2026-11-10. | Yes |
| SuprSend | Active. The changelog runs to 2026-10-30 ([changelog](https://docs.suprsend.com/changelog/overview)), and `@suprsend/react` 1.6.0 was published 2026-11-17. | Yes |
| Liveblocks Notifications | Active. 3.25.1 shipped 2026-11-13. | Added: strong React fit |
| Customer.io Inbox | Active. Its docs were updated 2026-11-06. | Added: a different model (marketing suite) |
| Stream Activity Feeds v3 | Active, but offers hooks only, with no bell UI and no channels. | Covered briefly |
| Engagespot | Appears dead. The site serves a 404, the docs root returns 404, and the last npm publish was 2025-05. | Dropped |
| OneSignal | Its in-app messages work only in mobile apps ([docs](https://documentation.onesignal.com/docs/en/in-app-messages-setup)). | Dropped |
| Pusher Beams | Push only ([docs](https://pusher.com/docs/beams/)). | Dropped |
| Velt | Built around comments and documents. Feed items are dropped after 15 days, and pricing is per active document ([docs](https://velt.dev/docs/async-collaboration/notifications/overview)). | Dropped |
| Fyno | Now targets Indian banking. Has no public pricing, and its React package is still alpha. | Dropped |

## Comparison at a glance

Billing units differ, so free tiers that look alike are not. "Per channel" means that one event sent both in-app and by email bills as 2.

| | Knock | Novu (Cloud) | Courier | MagicBell | SuprSend | Liveblocks | In-house |
|---|---|---|---|---|---|---|---|
| **React inbox UI** | Prebuilt popover, feed and bell, plus hooks | Prebuilt `<Inbox>`, Bell and Preferences, plus hooks or headless JS | Prebuilt Web Components wrapped for React, plus the `useCourier` hook | Prebuilt floating inbox and preferences; no documented hooks | Prebuilt Inbox and feed, plus headless hooks | Prebuilt list, plus hooks | Build it with shadcn (no popover component exists yet) |
| **React 19** | peer `^17\|\|^18\|\|^19` | peer `^18\|\|^19` | peer `>=18`, client-side render only | no peer declared | peer `>=16.8`; a dependency declares React ≤18 | peer `^18\|\|^19` | n/a |
| **Realtime** | WebSocket (Phoenix channels), no polling fallback | WebSocket (PartySocket on Cloud, socket.io self-hosted) | WebSocket | WebSocket | WebSocket (socket.io) | **Polling every 60 s** | Polling or SSE (a resource route) |
| **Billing unit** | Message, counted per user **per channel** | Workflow run, counted per subscriber (all channels in one run) | Send, counted per recipient (**all channels count as one**) | Delivery, counted per user **per channel** | Notification, counted per user **per channel** | Event, counted per user | n/a |
| **Free tier** | 10k messages a month, soft limit | 10k runs a month, **hard stop (HTTP 402)** | 10k sends a month | **1k** deliveries a month | 10k notifications a month, soft limit | **200** events a month, hard cap | n/a |
| **First paid tier** | $250/mo, 50k messages, then $0.005 each | $30/mo, 30k runs, then $1.20 per 1k | Pay as you go at $0.005 a send, first 10k included (50k = $250) | $249/mo, 50k deliveries, then $0.0025 each | $100/mo, 50k (Essentials). Preferences and digest need $250/mo (Business) | $30/mo in credits, $0.005 an event | Hosting you already pay for |
| **Branding on free tier** | "Powered by Knock" | Novu branding | None found (unverified) | not stated | SuprSend branding | Liveblocks branding | none |
| **Postmark** | Native | Native | Native | **Not native** (SMTP only) | Native | You send it yourself from a webhook | Existing `mailer.server.ts` |
| **Digest or batching** | Batch step, on all plans | Digest on all plans (Free window: 1 day) | Listed under Enterprise on the pricing page | None | Business ($250/mo) and up | Per-kind batching, up to 50 | Build it |
| **Preferences UI** | Hooks only, build the UI yourself | Prebuilt, Free tier included | Prebuilt `<CourierPreferences>` | Prebuilt `UserPreferences` | Business ($250/mo) and up | Hooks only (beta) | Build it |
| **In-app retention** | Indefinite; custom retention not supported | 30 days (Free), 90 days (paid) | Not documented (unverified); per-message expiry exists | Not documented | Expiry set per template | Not documented | Your choice |
| **EU region** | **None yet** ("expected by end of 2026") | US and EU on all plans | EU (Ireland) on paid plans only | None documented | In the docs, but the pricing page lists it as Enterprise (conflict) | Enterprise only | Wherever you host |
| **Self-host / OSS** | No (SDKs MIT/Apache) | **Yes: MIT core.** Needs MongoDB, Redis, S3 and 4 services | No ("managed cloud only") | No | Enterprise only (Kubernetes, Postgres, ClickHouse, …) | Enterprise add-on | It is your code |

## What the decision hinges on

1. **Notification volume, and how much of it also goes by email.**
   - Knock, MagicBell and SuprSend bill per channel, so adding email later doubles the bill for those events.
   - Novu bills per run and Courier per send, so adding email changes neither bill.
   - Fan-out events multiply the count by the number of recipients. "New Refund Request", for example, goes to every Platform Admin.
2. **EU data residency on a small plan.**
   - Novu offers it on every plan, including Free.
   - Courier offers it from the first paid plan.
   - Knock does not offer it yet.
   - MagicBell documents nothing, and SuprSend's sources conflict.
   - Notification payloads would hold Student names and course activity.
3. **What happens at the free-tier limit.** Novu Free rejects triggers with HTTP 402, so in-app notifications stop arriving. Knock and SuprSend use soft limits. Courier makes you move to pay-as-you-go to go past 10k.
4. **How much of the "Not yet specified" list a vendor would decide for us.** Preferences, digests and retention come built in from Novu, and from Knock or SuprSend at different price points. In-house, each of them is something to build. If the catalogue stays small and preferences stay out of scope, the in-house build stays small.
5. **Cost of the integration seam against what the stack already gives us.**
   - Every vendor adds:
     - a server-signed user token (JWT or HMAC)
     - a third-party WebSocket in the browser
     - user sync (identify or upsert)
     - a network call on each trigger
   - In-house gets the bell from one table, a count in the `layout.app.tsx` loader, and polling or SSE. That works because Cadence is a single process (ADR 0006).

## Per-option detail

### Knock

- **Components** ([React overview](https://docs.knock.app/in-app-ui/react/overview), [feed](https://docs.knock.app/in-app-ui/react/feed)):
  - Packages: `@knocklabs/react` (UI), `@knocklabs/react-core` (hooks such as `useKnockFeed` and `usePreferences`) and `@knocklabs/client`.
  - Components: `NotificationIconButton` (unread or unseen badge), `NotificationFeedPopover` and `NotificationFeed`.
  - Styling: `--rnf-*` CSS variables, plus `renderItem` and `renderHeader` for custom rendering.
  - States: seen, read, interacted and archived ([feeds overview](https://docs.knock.app/in-app-ui/feeds/overview)).
  - No prebuilt preference center: build one with the hooks ([preferences](https://docs.knock.app/in-app-ui/react/preferences)).
- **Realtime:**
  - The client uses Phoenix channels over `wss://api.knock.app/ws/v1` (source in the `@knocklabs/client` 0.23.1 tarball).
  - It has no polling fallback, and it disconnects while the page is hidden.
  - Optional cross-tab sync uses BroadcastChannel.
- **Model** ([concepts](https://docs.knock.app/concepts/overview)):
  - Workflows are made of channel steps and function steps: batch, delay, throttle and branch ([designing workflows](https://docs.knock.app/designing-workflows/overview)).
  - Recipients are Users (upsert with `PUT /v1/users/{id}`) or Objects, and Objects have subscriptions for fan-out. Tenants also exist.
  - Trigger from Node with `client.workflows.trigger(key, { recipients, data, tenant })` and an `Idempotency-Key` ([trigger API](https://docs.knock.app/send-notifications/triggering-workflows/api)).
  - Templates are Liquid. The CLI can pull and push workflows and templates as files ([CLI](https://docs.knock.app/cli/overview)).
- **Auth:** by default, anyone with the feed ID can read the feed. "Enhanced security mode" requires an RS256 user token signed with `signUserToken` ([security](https://docs.knock.app/in-app-ui/security-and-authentication)).
- **Channels:**
  - Email, SMS, push, chat and webhook ([integrations](https://docs.knock.app/integrations/overview)).
  - Postmark is native and supports `MessageStream` ([Postmark](https://docs.knock.app/integrations/email/postmark)).
- **Pricing** ([pricing](https://knock.app/pricing)):
  - Free: 10k messages a month. "We don't hard cap your messages."
  - Starter: $250 a month for 50k messages, then $0.005 each.
  - Branding removal requires Starter.
  - A message is "a single message delivered to a single user on a single channel", so "a workflow that notifies a user by both email and in-app results in two messages" ([plans](https://docs.knock.app/manage-your-account/knock-plans)).
- **Retention:** "In-app feed notifications are available indefinitely". "Custom retention policies are not currently supported." Logs are kept 30 days on Free and Starter ([data retention](https://docs.knock.app/manage-your-account/data-retention)).
- **Residency and lock-in:**
  - US only for now: "We expect to support EU data residency by the end of 2026" ([plans](https://docs.knock.app/manage-your-account/knock-plans)).
  - Messages can be exported through `GET /v1/messages` and the user feed endpoints ([knock-node api.md](https://github.com/knocklabs/knock-node/blob/main/api.md)).
  - No self-hosting.
- **Dev and tests:** the in-app channel has no sandbox mode ([plans](https://docs.knock.app/manage-your-account/knock-plans)). Tests would mock the SDK.

### Novu

- **Components** ([inbox overview](https://docs.novu.co/platform/inbox/overview), [React SDK](https://docs.novu.co/platform/sdks/react)):
  - `@novu/react` 3.20 (ISC) provides `<Inbox>` and the composable `Bell`, `Notifications` and `Preferences`.
  - The headless option is `@novu/js`, with methods `list`, `count`, `read`, `readAll`, `archive`, `snooze` and preferences.
  - "Read" (a user action) and "seen" (set automatically when shown) are separate, each with its own count event ([JS SDK](https://docs.novu.co/platform/sdks/javascript)).
  - Theming goes through the `appearance` prop's `variables` and `elements`, plus render props.
- **Realtime:** WebSocket. Novu Cloud uses PartySocket and self-hosted uses socket.io. The EU endpoint is `wss://eu.socket.novu.co`.
- **Model:**
  - **Subscriber:** `subscriberId` (the docs recommend your own user id), upserted just in time on trigger ([subscribers](https://docs.novu.co/platform/concepts/subscribers)).
  - **Workflow:** in-app, email, SMS, push and chat steps, plus delay, digest and throttle ([workflows](https://docs.novu.co/platform/workflow/overview)).
  - **Topics:** used for fan-out.
  - **Context:** `context: { tenant }` replaces tenants.
  - **Server SDK:** `@novu/api`, as `novu.trigger({ workflowId, to, payload })` ([TS SDK](https://docs.novu.co/platform/sdks/server/typescript)). The older `@novu/node` is end-of-support.
  - **Code-first option:** `@novu/framework` uses a "bridge endpoint" in your app. It ships no React Router handler, and its `remix` handler probably fits, but that is unverified ([framework](https://docs.novu.co/framework/overview)).
- **Auth:** production should turn on HMAC, with `subscriberHash = HMAC-SHA256(secretKey, subscriberId)` computed on the server ([prepare for production](https://docs.novu.co/platform/inbox/prepare-for-production)).
- **Channels:** Postmark is a native provider, one of about 19 email providers ([email integrations](https://docs.novu.co/platform/integrations/email)).
- **Limits:**
  - Digest and delay windows: 1 day on Free, 7 days on Pro.
  - Workflows: 5 on Free, 20 on Pro.
  - Trigger rate limit: 60 requests per second on Free.
  - Sources: [limits](https://docs.novu.co/platform/developer/limits), [rate limits](https://docs.novu.co/api-reference/rate-limiting).
- **Pricing** ([pricing](https://novu.co/pricing), [billing](https://docs.novu.co/platform/account/billing)):
  - "A workflow run is one execution of a workflow for one subscriber."
  - Free covers 10k runs. After that, "Trigger requests are rejected with HTTP `402` until the billing period resets or you upgrade".
  - Pro starts at $30 a month for 30k runs, then $1.20 per 1k.
  - Team starts at $250 a month.
  - Novu branding cannot be removed on Free.
- **Retention:** inbox messages are kept 30 days on Free and 90 days on Pro and Team ([limits](https://docs.novu.co/platform/developer/limits)).
- **Self-host:**
  - Licence: everything outside `enterprise/packages` is **MIT**. The enterprise packages (auth, billing, translation, ai, agents, …) are under a proprietary licence ([LICENSE-ENTERPRISE](https://github.com/novuhq/novu/blob/next/LICENSE-ENTERPRISE)).
  - The Community edition **includes** the Inbox, Bell, Preferences, digest, and both GUI and code workflows.
  - It **excludes** snooze, branding removal, more than 2 environments, translations, SSO and RBAC ([self-hosted vs cloud](https://docs.novu.co/community/self-hosted-and-novu-cloud)).
  - Infrastructure: API, Worker, WS and Dashboard services, plus MongoDB, Redis and S3-compatible storage, on a VM of about 4 vCPU and 8 GB ([self-hosting overview](https://docs.novu.co/community/self-hosting-novu/overview)).
- **Residency:**
  - US and EU regions on all plans.
  - Region is fixed, with no migration between regions.
  - No documented process for exporting data ([security](https://docs.novu.co/platform/additional-resources/security)).
- **Dev and tests:** Free includes 2 environments (development and production). Usage in every environment counts toward the 10k runs ([billing](https://docs.novu.co/platform/account/billing)).

### Courier

- **Components** ([React SDK](https://www.courier.com/docs/platform/inbox/web/react-sdk)):
  - `@trycourier/courier-react` wraps Web Components: `<CourierInbox>`, `<CourierInboxPopupMenu>`, `<CourierToast>` and `<CourierPreferences>`.
  - The hook is `useCourier()`, which exposes `inbox.totalUnreadCount`.
  - Actions: read, unread, archive, readAll and archiveRead.
  - Rendering: "render client-side only".
- **Realtime:**
  - WebSocket at `wss://realtime.courier.io`, opened by `inbox.listenForUpdates()`. Without that call the inbox loads once and never updates.
  - No polling fallback was found (unverified).
- **Model:**
  - `POST /send` takes `to` (a `user_id` or a list), a template or inline content, `data` and routing channels. Add `inbox` to the routing channels to reach the bell ([send](https://www.courier.com/docs/platform/sending/send-message)).
  - Users are profiles. Fan-out uses lists and audiences.
  - Tenants exist ([tenants](https://www.courier.com/docs/tenants/overview)).
  - Journeys provide delay, batch, digest and throttle.
- **Auth:** a JWT is mandatory. Mint it with `POST /auth/issue-token` using user-scoped scopes ([auth](https://courier.com/docs/platform/inbox/authentication)).
- **Channels:** broad provider list, Postmark included ([integrations](https://www.courier.com/docs/integrations/overview)).
- **Pricing** ([pricing](https://www.courier.com/pricing)):
  - Developer: 10k sends a month, free.
  - Business: $0.005 a send, "including the first 10,000".
  - "One send is one template sent to one recipient". Sending it across several channels "still counts as one send".
  - The pricing page lists "Digest & batching" and "Multi-tenant support" under Enterprise, although the Journeys docs show no plan gate. Treat this as a conflict.
- **Self-host:** none. "Courier is a managed cloud platform, with no self-hosted or on-premise option" ([overview](https://www.courier.com/docs/overview)).
- **Residency:** EU (Ireland) "is available on every paid plan". It is a separate workspace, and data is not migrated into it ([EU datacenter](https://www.courier.com/docs/platform/workspaces/eu-datacenter)).
- **Logs:** kept 30 days on Developer and Business ([logs](https://www.courier.com/docs/monitor/logs)).
- **Lock-in:** templates use Courier's Elemental JSON format.
- **Dev and tests:** "Test and custom environments count the same as Production" toward sends ([pricing](https://www.courier.com/pricing)).

### MagicBell

- **Components** ([docs](https://www.magicbell.com/docs/libraries/magicbell-react)):
  - The current package is `@magicbell/react`, with floating inbox, inbox, `UserPreferences` and toast components, themed through CSS variables.
  - It documents no headless hooks. For lower-level access use `magicbell-js` (user client and realtime).
  - The legacy `@magicbell/magicbell-react` and `@magicbell/react-headless` packages are no longer in the monorepo.
- **Realtime:** WebSocket with automatic reconnection ([magicbell-js](https://www.magicbell.com/docs/libraries/magicbell-js)).
- **Model:**
  - A "Broadcast" has a title, content, category, topic, `action_url` and 1–1000 recipients, which can be users or topics ([broadcast](https://www.magicbell.com/docs/primitive/broadcast)).
  - Users are created or updated with `PUT /users`.
  - Workflows offer only broadcast, wait, pause and abort steps. There is no digest step.
- **Auth:** an HS256 user JWT signed with the project secret ([auth](https://www.magicbell.com/docs/api/authentication/user)).
- **Channels:**
  - Email providers are Ping, SES, Mailgun, SendGrid and SMTP. **Postmark is not native**; connecting it over SMTP is an inference ([email](https://www.magicbell.com/docs/channels/email)).
  - Push, SMS (Twilio), Slack and Teams are also available.
- **Pricing** ([pricing](https://www.magicbell.com/pricing)):
  - Builder: $0 for **1,000** deliveries a month.
  - Startup: $249 a month for 50k deliveries, then $0.0025 each.
  - "We add up all the channels a user receives a notification on."
- **Residency and self-hosting:** no EU region documented, and no self-hosting.

### SuprSend

- **Components** ([React SDK](https://docs.suprsend.com/docs/react-sdk.md), [headless](https://docs.suprsend.com/docs/react-sdk-headless-feed.md)):
  - `@suprsend/react` (MIT) provides `Inbox`, `NotificationFeed` and Preferences, themed through a theme object and replaceable sub-components.
  - `@suprsend/react-core` provides hooks such as `useFeedData` and `useFeedClient`.
  - The legacy `@suprsend/react-inbox` is deprecated.
  - React 19 is not stated. A bundled dependency (`react-popper`) declares a React ≤18 peer, which may cause install friction (unverified).
- **Realtime:** WebSocket through socket.io, with reachability states ([JS feed](https://docs.suprsend.com/docs/js-inapp-feed.md)).
- **Model:**
  - Users are identified by `distinct_id`. Objects, lists and tenants also exist.
  - Workflows are built in the dashboard; there is no code-first DSL.
  - Trigger from Node with `@suprsend/node-sdk`, as `workflows.trigger(...)`, with up to 100 recipients and an idempotency key ([trigger](https://docs.suprsend.com/docs/node-trigger-workflow-from-api.md)).
- **Auth:** an ES256 signed user JWT in "enhanced security mode" ([client auth](https://docs.suprsend.com/docs/client-authentication.md)).
- **Channels:** Postmark is native ([Postmark](https://docs.suprsend.com/docs/postmark.md)). SMS, WhatsApp, push, Slack and Teams are also available.
- **Pricing** ([pricing](https://www.suprsend.com/pricing)):
  - Free: 10k notifications a month.
  - Essentials: $100 a month for 50k, then $2 per 1k.
  - Business: $250 a month for 50k, then $5 per 1k.
  - "each channel counts as a separate notification".
  - **Preferences, the preference-centre UI, batching and digest require Business.**
  - SuprSend branding shows on Free.
- **Self-host:** Enterprise only, through a private Helm chart on Kubernetes with Postgres, ClickHouse, Redis, OpenSearch and Temporal ([self-host](https://www.suprsend.com/self-host)).
- **Residency:** the docs say EU data residency is supported ([security](https://docs.suprsend.com/docs/security.md)), but the pricing page lists "Custom Data Center Region" as Enterprise. **Unclear for small plans.**
- **Retention:** expiry is set per template; the docs recommend 15 days or more ([inbox template](https://docs.suprsend.com/docs/in-app-inbox-template.md)).

### Alternatives worth knowing

- **Liveblocks Notifications** ([hooks](https://liveblocks.io/docs/products/notifications/hooks), [pricing](https://liveblocks.io/pricing)):
  - **Components:** `@liveblocks/react` and `@liveblocks/react-ui`, peer React `^18||^19`. Hooks include `useUnreadInboxNotificationsCount`, `useMarkAllInboxNotificationsAsRead` and others. There is a prebuilt `InboxNotificationList`.
  - **Realtime is polling.** The React package polls inbox notifications every **1 minute** ([config.ts](https://github.com/liveblocks/liveblocks/blob/main/packages/liveblocks-react/src/config.ts)).
  - **Model:** trigger one user at a time with `triggerInboxNotification`. There are no workflows or templates, and no archive (only delete).
  - **Email:** a webhook to your own server, where you send through your own provider, Postmark included ([email notifications](https://liveblocks.io/docs/products/notifications/email-notifications)).
  - **Pricing:** Free has 200 custom events a month as a hard cap, with branding. Pro is $30 a month in credits at $0.005 an event.
  - **Residency:** EU region on Enterprise only.
- **Customer.io Notification Inbox** ([inbox](https://docs.customer.io/integrations/data-in/connections/javascript/inbox/), [pricing](https://customer.io/pricing)):
  - **Components:** no React component. You get either a Design-Studio "visual inbox" or a JS API (`messages()`, `totalUnopened()`, `onUpdates`).
  - **Limits:** one inbox per workspace, and messages expire within 60 days.
  - **Auth:** no client identity verification documented for the inbox (unverified gap).
  - **Pricing:** billed per profile. Essentials is $100 a month for 5k profiles, with no free tier.
  - **Residency:** EU data centre on all plans.
  - **Fit:** this is a marketing-automation suite.
- **Stream Activity Feeds v3** ([notification feeds](https://getstream.io/activity-feeds/docs/react/notification-feeds/), [pricing](https://getstream.io/activity-feeds/pricing/)):
  - **Components:** hooks only, with no bell UI and no other channels.
  - **Pricing:** free up to 5k activities a month. Paid starts at $499 a month.

### Building in-house on Cadence's stack

How the pieces would fit, with sources:

- **Table.**
  - A `notifications` table in `app/db/schema.ts`: `recipient_user_id → users.id`, `type` (a TS enum through `.$type<>()`, as the schema already does), `payload` as `text(..., { mode: "json" })`, `link`, `created_at`, `read_at` and an optional `archived_at`.
  - An index on `(recipient_user_id, read_at, created_at)`.
  - Drizzle recommends text over blob for JSON because SQLite's JSON functions reject BLOBs ([Drizzle SQLite column types](https://orm.drizzle.team/docs/column-types/sqlite)).
  - Partial indexes (`WHERE read_at IS NULL`) are supported by SQLite ([partial indexes](https://sqlite.org/partialindex.html)). Drizzle-kit has had issues generating them for SQLite, so check the generated SQL (unverified).
  - Migrations follow the repo's `database-migrations` skill (`npm run db:generate`, then seed).
- **Unread count.**
  - `app/root.tsx` has no loader, but `app/routes/layout.app.tsx` already resolves the current user for every signed-in page. One `count(*)` query there would feed the bell.
  - "When the action completes, all loader data on the page is revalidated" ([actions](https://reactrouter.com/start/framework/actions)), so a mark-read action refreshes the count for free.
  - `useFetcher` submits mark-read or mark-all-read without navigating ([fetchers](https://reactrouter.com/how-to/fetchers)).
- **Freshness options.**
  1. **Polling.** `useRevalidator` exists for "polling on an interval" ([useRevalidator](https://reactrouter.com/api/hooks/useRevalidator)), but it reruns *all* active loaders, and the layout loader is heavy. A `fetcher.load` against a small `api.notifications` resource route ([resource routes](https://reactrouter.com/how-to/resource-routes)), paused while the page is hidden ([Page Visibility](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)), is lighter.
  2. **SSE.**
     - How it works: a resource route returns a `ReadableStream` with `Content-Type: text/event-stream`, and the browser uses `EventSource` ([MDN SSE](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)).
     - Production server (from reading the source, not running it): `@react-router/express` 8.3.0 flushes headers for `text/event-stream` and aborts `request.signal` on disconnect, and the Node stream writer flushes the compression middleware after each chunk.
     - Dev server: behaviour under `react-router dev` is unverified.
     - Connection limit: without HTTP/2, browsers allow 6 connections per domain across all tabs ([EventSource](https://developer.mozilla.org/en-US/docs/Web/API/EventSource)). `react-router-serve` speaks HTTP/1.1.
     - Fan-out: an in-process `EventEmitter` keyed by user id works only because there is one process (ADR 0006).
     - Helper library: the community package `remix-utils` 10.x offers `eventStream` and `useEventSource`, and requires React Router v8 ([remix-utils](https://github.com/sergiodxa/remix-utils)).
     - No official React Router SSE guide was found.
  3. **WebSockets.** These need a custom server built on `@react-router/express` instead of `react-router-serve` ([adapter](https://reactrouter.com/api/other-api/adapter)).
- **SQLite.**
  - WAL is already on (`app/db/index.ts`).
  - "readers do not block writers and a writer does not block readers", but "there can only be one writer at a time" ([WAL](https://sqlite.org/wal.html)).
  - Notification inserts and mark-all-read are single small statements. Fanning out to every Platform Admin could share the domain write's transaction.
- **Email headroom.**
  - A `notify()` service could insert in-app rows and call the existing `sendEmail`.
  - Today, `sendEmail` is awaited inline after the domain write (`app/routes/admin.refunds.tsx`, `app/routes/courses.$slug.refund.ts`), with no retries and no delivery record.
  - A delivery log or retry table would be new work.
- **What you build yourself that vendors bundle** (inference):
  - preferences per type and channel
  - digests and batching
  - templates and localisation
  - retries and delivery logs
  - read-state sync across channels
  - extra channels
  - debug UI
- **Pieces to build:**
  - schema and migration, plus a seed line in `scripts/seed.ts`
  - `app/lib/notifications.server.ts` (`notify`, `countUnread`, `list`, `markRead`, `markAllRead`, recipient resolvers)
  - a count in the layout loader
  - an `api.notifications` resource route (list, plus mark actions scoped to the current user)
  - the bell UI: lucide `Bell` (ADR 0007) in `app/components/sidebar.tsx`, and a popover added through shadcn (the repo has none yet)
  - the freshness transport
  - Vitest tests using `createTestDb()` from `app/test/setup.ts`
- **Dev and tests:**
  - Notifications are rows in the test database, so tests and DevUI can read them directly. This matches how `.outbox/` makes email visible.
  - With a vendor, tests would mock the SDK or need a vendor test environment, which counts toward usage on Novu and Courier.

## How the vendors map to the map's "Not yet specified" items

| Item | What vendors give | In-house |
|---|---|---|
| Preferences / muting | Novu: prebuilt on Free. Courier and MagicBell: prebuilt. Knock: hooks only. SuprSend: Business only. Liveblocks: hooks (beta). | Table and UI to build |
| Retention | Knock: indefinite, not configurable. Novu: 30 or 90 days, fixed by plan. SuprSend: per-template expiry. Customer.io: 60 days or less. | Your policy (a cleanup job) |
| Grouping / batching | Knock: batch step. Novu: digest (1 day on Free). SuprSend: Business only. Courier: Enterprise per the pricing page. MagicBell: none. Liveblocks: per-kind batching. | Build it, or group at read time |
| Data model / seam | Vendor-owned store, plus user sync and a token-signing endpoint | Your table, behind a `notify()` seam |
| Observability in dev/tests | Vendor dashboards and logs. Tests mock the SDK. | DB rows, like `.outbox/` |
