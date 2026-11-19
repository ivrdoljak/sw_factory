// PROTOTYPE — throwaway mock Notifications for the in-app UI prototype.
// Built from the v1 Notification Event list (see the "Which events produce
// Notifications, and for whom?" ticket). Nothing is persisted.
import { and, eq } from "drizzle-orm";
import { db } from "~/db";
import { courses, lessons, modules, UserRole } from "~/db/schema";

export type ProtoNotificationEvent =
  | "refund-approved"
  | "refund-declined"
  | "refund-raised"
  | "seat-claimed"
  | "new-question"
  | "new-reply";

export interface ProtoNotification {
  id: string;
  event: ProtoNotificationEvent;
  actor: string | null;
  title: string;
  detail: string | null;
  href: string;
  createdAt: string;
  read: boolean;
}

function ago(minutes: number) {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function sampleCourses(instructorId?: number) {
  const rows = db
    .select({ id: courses.id, slug: courses.slug, title: courses.title })
    .from(courses)
    .where(instructorId ? eq(courses.instructorId, instructorId) : undefined)
    .limit(3)
    .all();
  return rows.length > 0
    ? rows
    : db
        .select({ id: courses.id, slug: courses.slug, title: courses.title })
        .from(courses)
        .limit(3)
        .all();
}

function firstLesson(courseId: number) {
  return db
    .select({ id: lessons.id, title: lessons.title })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(and(eq(modules.courseId, courseId)))
    .limit(1)
    .get();
}

function lessonHref(course: { slug: string }, lessonId: number | undefined) {
  return lessonId
    ? `/courses/${course.slug}/lessons/${lessonId}`
    : `/courses/${course.slug}`;
}

export function buildMockNotifications(user: {
  id: number;
  role: UserRole;
  isTeamAdmin: boolean;
}): { initial: ProtoNotification[]; pool: ProtoNotification[] } {
  if (user.role === UserRole.Admin) {
    const cs = sampleCourses();
    const raised = (n: number, buyer: string, minutes: number, read = false) => ({
      id: `raised-${n}`,
      event: "refund-raised" as const,
      actor: buyer,
      title: `${buyer} requested a refund for ${cs[n % cs.length].title}.`,
      detail: null,
      href: "/admin/refunds",
      createdAt: ago(minutes),
      read,
    });
    return {
      initial: [
        raised(0, "Olivia Martinez", 12),
        raised(1, "Bossy McBossface", 60 * 5),
        raised(2, "James Park", 60 * 30, true),
        raised(0, "Noah Blackwood", 60 * 24 * 4, true),
      ].map((n, i) => ({ ...n, id: `${n.id}-${i}` })),
      pool: [raised(1, "Ava Nakamura", 0)],
    };
  }

  if (user.role === UserRole.Instructor) {
    const cs = sampleCourses(user.id);
    const items = cs.map((c) => ({ c, l: firstLesson(c.id) }));
    const q = (i: number, who: string, minutes: number, read = false) => {
      const { c, l } = items[i % items.length];
      return {
        id: `q-${i}-${minutes}`,
        event: "new-question" as const,
        actor: who,
        title: `${who} asked a question on ${l?.title ?? c.title}.`,
        detail: "“Why does the compiler complain when I pass undefined here?”",
        href: lessonHref(c, l?.id),
        createdAt: ago(minutes),
        read,
      };
    };
    const reply = (who: string, minutes: number, read = false) => {
      const { c, l } = items[0];
      return {
        id: `r-${minutes}`,
        event: "new-reply" as const,
        actor: who,
        title: `${who} replied on ${l?.title ?? c.title}.`,
        detail: "“Thanks, that fixed it! One follow-up though…”",
        href: lessonHref(c, l?.id),
        createdAt: ago(minutes),
        read,
      };
    };
    return {
      initial: [
        q(0, "Emma Wilson", 3),
        reply("James Park", 45),
        q(1, "Liam Thompson", 60 * 3),
        q(2, "Sophia Davis", 60 * 26, true),
        q(0, "Ava Nakamura", 60 * 24 * 6, true),
      ],
      pool: [q(1, "Olivia Martinez", 0)],
    };
  }

  // Student (a Team Admin is a Student with extra Notification Events).
  const cs = sampleCourses();
  const lesson = firstLesson(cs[0].id);
  const student: ProtoNotification[] = [
    {
      id: "reply-1",
      event: "new-reply",
      actor: "Sarah Chen",
      title: `Sarah Chen replied on ${lesson?.title ?? cs[0].title}.`,
      detail: "“Good question — the short answer is structural typing…”",
      href: lessonHref(cs[0], lesson?.id),
      createdAt: ago(20),
      read: false,
    },
    {
      id: "refund-declined-1",
      event: "refund-declined",
      actor: null,
      title: `Your refund request for ${cs[2 % cs.length].title} was declined.`,
      detail:
        "Note from Cadence: you've watched most of the course, so it's past the Watch Limit for a refund.",
      href: `/courses/${cs[2 % cs.length].slug}`,
      createdAt: ago(60 * 7),
      read: false,
    },
    {
      id: "refund-approved-1",
      event: "refund-approved",
      actor: null,
      title: `Your refund request for ${cs[1 % cs.length].title} was approved.`,
      detail: null,
      href: `/courses/${cs[1 % cs.length].slug}`,
      createdAt: ago(60 * 24 * 3),
      read: true,
    },
  ];

  const seat = (who: string, minutes: number, read = false) => ({
    id: `seat-${who}`,
    event: "seat-claimed" as const,
    actor: who,
    title: `${who} claimed a Seat on ${cs[0].title}.`,
    detail: null,
    href: "/team",
    createdAt: ago(minutes),
    read,
  });

  const teamExtras = user.isTeamAdmin
    ? [seat("Liam Thompson", 8), seat("Sophia Davis", 60 * 2), seat("Ava Nakamura", 60 * 50, true)]
    : [];

  const initial = [...student, ...teamExtras].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );

  const pool: ProtoNotification[] = user.isTeamAdmin
    ? [seat("Noah Blackwood", 0)]
    : [
        {
          ...student[0],
          id: "reply-2",
          actor: "Marcus Johnson",
          title: `Marcus Johnson replied on ${lesson?.title ?? cs[0].title}.`,
          createdAt: ago(0),
          read: false,
        },
      ];

  return { initial, pool };
}
