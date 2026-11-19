// PROTOTYPE — throwaway. Three structurally different takes on in-app
// Notifications, switchable with ?variant=A|B|C and the floating bar.
// Mock data only (see app/lib/notifications.prototype.server.ts); read state
// lives in memory and resets on reload.
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Dialog, Popover } from "radix-ui";
import {
  Bell,
  CheckCheck,
  CircleCheck,
  CircleX,
  Inbox,
  MessageSquare,
  Receipt,
  UserPlus,
  X,
} from "lucide-react";
import { cn, formatRelativeTime } from "~/lib/utils";
import {
  PrototypeSwitcher,
  usePrototypeVariant,
  useStickyVariantParam,
  type PrototypeVariant,
} from "~/components/prototype-switcher";
import type {
  ProtoNotification,
  ProtoNotificationEvent,
} from "~/lib/notifications.prototype.server";

export const NOTIFICATION_VARIANTS: PrototypeVariant[] = [
  { key: "A", name: "Sidebar bell → popover" },
  { key: "B", name: "New top bar → slide-over drawer" },
  { key: "C", name: "Sidebar Inbox → full inbox view" },
  { key: "D", name: "Sidebar row (A) → drawer (B)" },
];

const eventIcon: Record<ProtoNotificationEvent, React.ReactNode> = {
  "refund-approved": <CircleCheck className="size-4 text-green-600" />,
  "refund-declined": <CircleX className="size-4 text-red-600" />,
  "refund-raised": <Receipt className="size-4 text-amber-600" />,
  "seat-claimed": <UserPlus className="size-4 text-blue-600" />,
  "new-question": <MessageSquare className="size-4 text-violet-600" />,
  "new-reply": <MessageSquare className="size-4 text-sky-600" />,
};

// ─── State (shared by all variants; the UI is not) ───

function useProtoNotifications(
  userKey: string,
  initial: ProtoNotification[],
  pool: ProtoNotification[]
) {
  const [items, setItems] = useState(initial);
  const [poolIndex, setPoolIndex] = useState(0);
  // Loader data revalidates on every navigation; only reset when the DevUI
  // user changes, so read state survives clicking around.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setItems(initial), [userKey]);

  const unread = items.filter((n) => !n.read).length;
  return {
    items,
    unread,
    markRead: (id: string) =>
      setItems((xs) => xs.map((n) => (n.id === id ? { ...n, read: true } : n))),
    markUnread: (id: string) =>
      setItems((xs) => xs.map((n) => (n.id === id ? { ...n, read: false } : n))),
    markAllRead: () => setItems((xs) => xs.map((n) => ({ ...n, read: true }))),
    simulateNew: () => {
      if (pool.length === 0) return;
      const base = pool[poolIndex % pool.length];
      setPoolIndex((i) => i + 1);
      setItems((xs) => [
        { ...base, id: `${base.id}-sim-${Date.now()}`, createdAt: new Date().toISOString(), read: false },
        ...xs,
      ]);
    },
    clear: () => setItems([]),
    reset: () => setItems(initial),
  };
}

type Store = ReturnType<typeof useProtoNotifications>;

function UnreadBadge({ count, className }: { count: number; className?: string }) {
  if (count === 0) return null;
  return (
    <span
      className={cn(
        "inline-flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-[11px] font-semibold leading-5 text-white",
        className
      )}
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}

// ─── Variant A: sidebar row + compact popover ───

function VariantASidebar({ store }: { store: Store }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[state=open]:bg-sidebar-accent">
          <Bell className="size-4" />
          <span className="flex-1 text-left">Notifications</span>
          <UnreadBadge count={store.unread} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="right"
          align="start"
          sideOffset={12}
          className="z-50 w-96 rounded-lg border bg-popover text-popover-foreground shadow-xl"
        >
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <span className="text-sm font-semibold">Notifications</span>
            <button
              onClick={store.markAllRead}
              disabled={store.unread === 0}
              className="text-xs text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
            >
              Mark all as read
            </button>
          </div>
          {store.items.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              <Bell className="mx-auto mb-2 size-6 opacity-40" />
              You're all caught up.
            </div>
          ) : (
            <ul className="max-h-[420px] divide-y overflow-y-auto">
              {store.items.map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => {
                      store.markRead(n.id);
                      setOpen(false);
                      navigate(n.href);
                    }}
                    className={cn(
                      "flex w-full gap-3 px-4 py-3 text-left hover:bg-accent",
                      !n.read && "bg-primary/5"
                    )}
                  >
                    <span className="mt-0.5">{eventIcon[n.event]}</span>
                    <span className="min-w-0 flex-1">
                      <span className={cn("block text-sm", !n.read && "font-semibold")}>
                        {n.title}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatRelativeTime(n.createdAt)}
                      </span>
                    </span>
                    {!n.read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ─── Variant B: new top bar + right-hand drawer, grouped by day ───

function NotificationDrawer({
  store,
  trigger,
}: {
  store: Store;
  trigger: React.ReactNode;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const shown = store.items.filter((n) => filter === "all" || !n.read);
  const groups = useMemo(() => {
    const today: ProtoNotification[] = [];
    const earlier: ProtoNotification[] = [];
    const cutoff = Date.now() - 24 * 60 * 60_000;
    for (const n of shown) (Date.parse(n.createdAt) > cutoff ? today : earlier).push(n);
    return [
      { label: "Last 24 hours", items: today },
      { label: "Earlier", items: earlier },
    ].filter((g) => g.items.length > 0);
  }, [shown]);

  return (
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
          <Dialog.Content className="fixed inset-y-0 right-0 z-50 flex w-[440px] flex-col border-l bg-background shadow-2xl">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <Dialog.Title className="text-base font-semibold">Notifications</Dialog.Title>
              <Dialog.Close className="rounded-md p-1 hover:bg-accent">
                <X className="size-4" />
              </Dialog.Close>
            </div>
            <div className="flex items-center gap-1 border-b px-5 py-2">
              {(["all", "unread"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium capitalize",
                    filter === f ? "bg-foreground text-background" : "hover:bg-accent"
                  )}
                >
                  {f}
                  {f === "unread" && store.unread > 0 ? ` (${store.unread})` : ""}
                </button>
              ))}
              <button
                onClick={store.markAllRead}
                disabled={store.unread === 0}
                className="ml-auto flex items-center gap-1 text-xs text-primary disabled:text-muted-foreground"
              >
                <CheckCheck className="size-3.5" /> Mark all as read
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {groups.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                  <CheckCheck className="size-8 opacity-40" />
                  {filter === "unread" ? "No unread Notifications." : "Nothing here yet."}
                </div>
              ) : (
                groups.map((g) => (
                  <section key={g.label}>
                    <h3 className="bg-muted/50 px-5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {g.label}
                    </h3>
                    {g.items.map((n) => (
                      <article
                        key={n.id}
                        className={cn(
                          "group flex gap-3 border-b px-5 py-4",
                          !n.read && "border-l-4 border-l-primary pl-4"
                        )}
                      >
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
                          {eventIcon[n.event]}
                        </div>
                        <div className="min-w-0 flex-1">
                          <button
                            onClick={() => {
                              store.markRead(n.id);
                              setOpen(false);
                              navigate(n.href);
                            }}
                            className={cn("text-left text-sm hover:underline", !n.read && "font-semibold")}
                          >
                            {n.title}
                          </button>
                          {n.detail && (
                            <p className="mt-1 rounded-md bg-muted/60 px-2.5 py-1.5 text-xs text-muted-foreground">
                              {n.detail}
                            </p>
                          )}
                          <div className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground">
                            {formatRelativeTime(n.createdAt)}
                            <button
                              onClick={() => (n.read ? store.markUnread(n.id) : store.markRead(n.id))}
                              className="opacity-0 hover:text-foreground group-hover:opacity-100"
                            >
                              Mark as {n.read ? "unread" : "read"}
                            </button>
                          </div>
                        </div>
                      </article>
                    ))}
                  </section>
                ))
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
  );
}

function VariantBTopBar({ store }: { store: Store }) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-end gap-2 border-b bg-background px-6">
      <span className="mr-auto text-xs text-muted-foreground">
        (This top bar is new; Cadence has none today.)
      </span>
      <NotificationDrawer
        store={store}
        trigger={
          <button className="relative rounded-full p-2 hover:bg-accent" title="Notifications">
            <Bell className="size-5" />
            <UnreadBadge count={store.unread} className="absolute -right-0.5 -top-0.5" />
          </button>
        }
      />
    </header>
  );
}

// ─── Variant D: the user's pick — A's sidebar row opens B's drawer ───

function VariantDSidebar({ store }: { store: Store }) {
  return (
    <NotificationDrawer
      store={store}
      trigger={
        <button className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[state=open]:bg-sidebar-accent">
          <Bell className="size-4" />
          <span className="flex-1 text-left">Notifications</span>
          <UnreadBadge count={store.unread} />
        </button>
      }
    />
  );
}

// ─── Variant C: sidebar "Inbox" entry → full two-pane inbox over the page ───

function VariantCSidebar({
  store,
  open,
  setOpen,
}: {
  store: Store;
  open: boolean;
  setOpen: (o: boolean) => void;
}) {
  return (
    <button
      onClick={() => setOpen(!open)}
      className={cn(
        "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        open
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      )}
    >
      <Inbox className="size-4" />
      <span className="flex-1 text-left">Inbox</span>
      {store.unread > 0 && (
        <span className="text-xs font-semibold text-primary">{store.unread} new</span>
      )}
    </button>
  );
}

function VariantCInbox({ store, close }: { store: Store; close: () => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(store.items[0]?.id ?? null);
  const selected = store.items.find((n) => n.id === selectedId) ?? null;

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-background">
      <div className="flex items-center gap-3 border-b px-8 py-5">
        <Inbox className="size-5" />
        <h1 className="text-xl font-bold">Inbox</h1>
        <span className="text-sm text-muted-foreground">
          {store.unread} unread of {store.items.length}
        </span>
        <button
          onClick={store.markAllRead}
          disabled={store.unread === 0}
          className="ml-auto rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
        >
          Mark all as read
        </button>
        <button onClick={close} className="rounded-md p-1.5 hover:bg-accent" title="Close inbox">
          <X className="size-4" />
        </button>
      </div>
      {store.items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
          <Inbox className="size-10 opacity-30" />
          <p className="text-sm">Your inbox is empty. Notifications about refunds, Seats and questions will land here.</p>
        </div>
      ) : (
        <div className="grid flex-1 grid-cols-[minmax(280px,380px)_1fr] overflow-hidden">
          <ul className="overflow-y-auto border-r">
            {store.items.map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => {
                    setSelectedId(n.id);
                    store.markRead(n.id);
                  }}
                  className={cn(
                    "w-full border-b px-5 py-3 text-left",
                    selectedId === n.id ? "bg-accent" : "hover:bg-accent/50"
                  )}
                >
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {!n.read && <span className="size-2 rounded-full bg-primary" />}
                    {n.event.replace("-", " ")}
                    <span className="ml-auto">{formatRelativeTime(n.createdAt)}</span>
                  </div>
                  <div className={cn("mt-1 line-clamp-2 text-sm", !n.read && "font-semibold")}>
                    {n.title}
                  </div>
                </button>
              </li>
            ))}
          </ul>
          <div className="overflow-y-auto p-10">
            {selected ? (
              <div className="max-w-xl">
                <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
                  {eventIcon[selected.event]}
                </div>
                <h2 className="text-lg font-semibold">{selected.title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {new Date(selected.createdAt).toLocaleString()}
                </p>
                {selected.detail && (
                  <blockquote className="mt-6 border-l-4 pl-4 text-sm">{selected.detail}</blockquote>
                )}
                <div className="mt-8 flex gap-2">
                  <Link
                    to={selected.href}
                    onClick={close}
                    className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                  >
                    Open
                  </Link>
                  <button
                    onClick={() => store.markUnread(selected.id)}
                    className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
                  >
                    Mark as unread
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Pick a Notification on the left.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Host: hands each layout slot its variant-specific piece ───

export function useNotificationsPrototype(
  userKey: string,
  initial: ProtoNotification[],
  pool: ProtoNotification[]
) {
  useStickyVariantParam();
  const variant = usePrototypeVariant(NOTIFICATION_VARIANTS);
  const store = useProtoNotifications(userKey, initial, pool);
  const [inboxOpen, setInboxOpen] = useState(false);

  const sidebarSlot =
    variant.key === "A" ? (
      <VariantASidebar store={store} />
    ) : variant.key === "D" ? (
      <VariantDSidebar store={store} />
    ) : variant.key === "C" ? (
      <VariantCSidebar store={store} open={inboxOpen} setOpen={setInboxOpen} />
    ) : null;

  const topBar = variant.key === "B" ? <VariantBTopBar store={store} /> : null;

  const mainOverlay =
    variant.key === "C" && inboxOpen ? (
      <VariantCInbox store={store} close={() => setInboxOpen(false)} />
    ) : null;

  const switcher = (
    <PrototypeSwitcher variants={NOTIFICATION_VARIANTS} current={variant}>
      <span className="mx-1 h-4 w-px bg-white/30" />
      <span className="tabular-nums text-white/70">
        {store.unread} unread / {store.items.length}
      </span>
      <button onClick={store.simulateNew} className="rounded-full px-2 py-0.5 hover:bg-white/15">
        + new
      </button>
      <button onClick={store.clear} className="rounded-full px-2 py-0.5 hover:bg-white/15">
        empty
      </button>
      <button onClick={store.reset} className="rounded-full px-2 py-0.5 hover:bg-white/15">
        reset
      </button>
    </PrototypeSwitcher>
  );

  return { sidebarSlot, topBar, mainOverlay, switcher };
}
