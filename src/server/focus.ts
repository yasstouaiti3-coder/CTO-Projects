import { createServerFn } from "@tanstack/react-start";
import { db, dbFailure, dbStatus, iso } from "~/db";
import { currentUser, requireUser } from "~/server/session";
import { oneStuckPrompt } from "~/server/ai";
import type { NotConnected } from "~/server/auth";

/**
 * The focus sprint — the heart of FocusPilot.
 *
 * A sprint is one row in `focus_sessions`: which task, which step, how long the
 * person planned, and when it started. The countdown is always derived from
 * `started_at` on the server's clock, so reloading the page (or closing the tab
 * and coming back) never resets or loses a sprint.
 *
 * One sprint is open at a time. Ending one is always allowed, and always asks
 * what happened in plain words — never a grade, never a streak, never a nudge.
 */

export const DURATIONS = [10, 20, 30] as const;
export type Outcome = "done" | "partly" | "stuck";
export type NextAction = "another" | "break" | "later";

export type SprintStep = { id: string; text: string };

export type SprintPage =
  | NotConnected
  | { kind: "signed_out" }
  | { kind: "missing" }
  | {
      kind: "ready";
      sessionId: string;
      taskId: string;
      taskTitle: string;
      plannedMinutes: number;
      startedAt: string;
      endedAt: string | null;
      outcome: Outcome | null;
      nextAction: NextAction | null;
      step: SprintStep | null;
      openSteps: number;
      nextStep: SprintStep | null;
    };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ZERO = "00000000-0000-0000-0000-000000000000";

function uuid(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  return UUID.test(raw) ? raw : ZERO;
}

export function cleanOutcome(value: unknown): Outcome | null {
  return value === "done" || value === "partly" || value === "stuck"
    ? value
    : null;
}

function cleanMinutes(value: unknown): number | null {
  const minutes = Number(value);
  return (DURATIONS as readonly number[]).includes(minutes) ? minutes : null;
}

/**
 * The step a sprint should run on: the first one not yet done, in the order the
 * person kept. Null when the task has no open steps left.
 */
async function currentStep(
  sql: Awaited<ReturnType<typeof db>>,
  userId: string,
  taskId: string
): Promise<SprintStep | null> {
  const rows = await sql<SprintStep[]>`
    select id, text
      from steps
     where task_id = ${taskId}::uuid and user_id = ${userId} and done = false
     order by position asc, created_at asc
     limit 1
  `;
  return rows[0] ?? null;
}

export const startSprint = createServerFn({ method: "POST" })
  .validator((data: { taskId: string; minutes: number }) => data)
  .handler(
    async ({
      data,
    }): Promise<
      | { ok: true; sessionId: string; resumed: boolean }
      | { ok: false; error: string }
    > => {
      const minutes = cleanMinutes(data.minutes);
      if (!minutes) return { ok: false, error: "Pick 10, 20 or 30 minutes." };

      const user = await requireUser();
      const sql = await db();
      const taskId = uuid(data.taskId);

      const tasks = await sql<{ id: string }[]>`
        select id from tasks
         where id = ${taskId}::uuid and user_id = ${user.id}
         limit 1
      `;
      if (!tasks[0]) {
        return { ok: false, error: "That task is no longer here." };
      }

      // A sprint already running on this task is resumed, not restarted: the
      // clock lives in the database, so the person gets back the time they have
      // left rather than a fresh countdown.
      const open = await sql<
        { id: string; started_at: Date; planned_minutes: number; running: boolean }[]
      >`
        select id, started_at, planned_minutes,
               (started_at + (planned_minutes * interval '1 minute')) > now() as running
          from focus_sessions
         where user_id = ${user.id} and task_id = ${taskId}::uuid and ended_at is null
         order by started_at desc
         limit 1
      `;
      const running = open[0];
      if (running) {
        if (running.running) {
          return { ok: true, sessionId: running.id, resumed: true };
        }
        // Time ran out and the loop was never closed. Close it honestly (no
        // outcome was given) so a new sprint can start — and so the count of
        // open sessions never grows behind the person's back.
        await sql`
          update focus_sessions
             set ended_at = started_at + (planned_minutes * interval '1 minute')
           where id = ${running.id}::uuid and user_id = ${user.id} and ended_at is null
        `;
      }

      const step = await currentStep(sql, user.id, taskId);
      if (!step) {
        return {
          ok: false,
          error:
            "Every step here is done. Break it down again for the next piece.",
        };
      }

      const created = await sql<{ id: string }[]>`
        insert into focus_sessions (user_id, task_id, step_id, planned_minutes, started_at)
        values (${user.id}, ${taskId}::uuid, ${step.id}::uuid, ${minutes}, now())
        returning id
      `;
      const sessionId = created[0]?.id;
      if (!sessionId) return { ok: false, error: "Couldn't start that. Try again." };
      return { ok: true, sessionId, resumed: false };
    }
  );

/**
 * What the task page and the inbox need: is a sprint open on this task, and is
 * its clock still ticking? `running` is decided by the server (`started_at +
 * planned_minutes > now()`), so the words on the page match the truth even when
 * the timer has quietly run out: an open sprint whose time is up is *not* still
 * running, and the page says so and offers to close it.
 */
export type OpenSprint = {
  sessionId: string;
  plannedMinutes: number;
  startedAt: string;
  running: boolean;
};

export const pageSprint = createServerFn({ method: "POST" })
  .validator((data: { sessionId: string }) => data)
  .handler(async ({ data }): Promise<SprintPage> => {
    const status = await dbStatus();
    if (!status.ok) {
      return {
        kind: "not_connected",
        reason: status.reason,
        message: status.message,
      };
    }
    try {
      const user = await currentUser();
      if (!user) return { kind: "signed_out" };

      const sql = await db();
      const rows = await sql<{
        id: string;
        task_id: string;
        task_title: string;
        planned_minutes: number;
        started_at: Date;
        ended_at: Date | null;
        outcome: string | null;
        next_action: string | null;
        step_id: string | null;
        step_text: string | null;
      }[]>`
        select fs.id, fs.task_id, t.title as task_title, fs.planned_minutes,
               fs.started_at, fs.ended_at, fs.outcome, fs.next_action,
               s.id as step_id, s.text as step_text
          from focus_sessions fs
          join tasks t on t.id = fs.task_id
          left join steps s on s.id = fs.step_id
         where fs.id = ${uuid(data.sessionId)}::uuid and fs.user_id = ${user.id}
         limit 1
      `;
      const row = rows[0];
      if (!row) return { kind: "missing" };

      const next = await currentStep(sql, user.id, row.task_id);
      const openRows = await sql<{ n: number }[]>`
        select count(*)::int as n from steps
         where task_id = ${row.task_id}::uuid and user_id = ${user.id} and done = false
      `;
      const step: SprintStep | null =
        row.step_id && row.step_text
          ? { id: row.step_id, text: row.step_text }
          : next;

      return {
        kind: "ready",
        sessionId: row.id,
        taskId: row.task_id,
        taskTitle: row.task_title,
        plannedMinutes: Number(row.planned_minutes),
        startedAt: iso(row.started_at),
        endedAt: row.ended_at ? iso(row.ended_at) : null,
        outcome: cleanOutcome(row.outcome),
        nextAction:
          row.next_action === "another" ||
          row.next_action === "break" ||
          row.next_action === "later"
            ? row.next_action
            : null,
        step,
        openSteps: Number(openRows[0]?.n ?? 0),
        nextStep: next,
      };
    } catch (error) {
      return dbFailure(error);
    }
  });

/**
 * Closing the loop. `done` marks the step done on the way out, which is what
 * advances the task to its next step; `partly` and `stuck` leave the step where
 * it is. Ending early is recorded exactly the same way as running out of time.
 */
export const endSprint = createServerFn({ method: "POST" })
  .validator((data: { sessionId: string; outcome: string }) => data)
  .handler(
    async ({
      data,
    }): Promise<
      | { ok: true; outcome: Outcome; nextStep: SprintStep | null; openSteps: number }
      | { ok: false; error: string }
    > => {
      const outcome = cleanOutcome(data.outcome);
      if (!outcome) return { ok: false, error: "Pick what happened first." };

      const user = await requireUser();
      const sql = await db();
      const sessionId = uuid(data.sessionId);

      const rows = await sql<{ id: string; task_id: string; step_id: string | null }[]>`
        select id, task_id, step_id
          from focus_sessions
         where id = ${sessionId}::uuid and user_id = ${user.id}
         limit 1
      `;
      const session = rows[0];
      if (!session) return { ok: false, error: "That sprint is no longer here." };

      await sql.begin(async (tx) => {
        await tx`
          update focus_sessions
             set ended_at = coalesce(ended_at, now()),
                 outcome = ${outcome},
                 completed = ${outcome === "done"}
           where id = ${sessionId}::uuid and user_id = ${user.id}
        `;
        if (outcome === "done" && session.step_id) {
          await tx`
            update steps
               set done = true, updated_at = now()
             where id = ${session.step_id}::uuid and user_id = ${user.id}
          `;
        }
      });

      const nextStep = await currentStep(sql, user.id, session.task_id);
      const openRows = await sql<{ n: number }[]>`
        select count(*)::int as n from steps
         where task_id = ${session.task_id}::uuid and user_id = ${user.id} and done = false
      `;
      return {
        ok: true,
        outcome,
        nextStep,
        openSteps: Number(openRows[0]?.n ?? 0),
      };
    }
  );

/** What the person chose to do next, kept on the same row for later reference. */
export const chooseNext = createServerFn({ method: "POST" })
  .validator((data: { sessionId: string; nextAction: string }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const nextAction: NextAction | null =
      data.nextAction === "another" ||
      data.nextAction === "break" ||
      data.nextAction === "later"
        ? data.nextAction
        : null;
    if (!nextAction) return { ok: false };
    const user = await requireUser();
    const sql = await db();
    await sql`
      update focus_sessions
         set next_action = ${nextAction}
       where id = ${uuid(data.sessionId)}::uuid and user_id = ${user.id}
    `;
    return { ok: true };
  });

/**
 * Plain, concrete, non-AI prompts. Used when there is no API key (or the model
 * is unavailable) and labelled as such on screen. Each one reduces the step to
 * something that can be started right now; none of them comments on the person.
 */
export const PLAIN_PROMPTS = [
  "Write the two-minute version of this step — what would you do with only two minutes?",
  "Name the very next physical action. Not the plan — the hand movement.",
  "What is missing before you can start? Write just that one thing.",
  "Open the last file or page you touched for this and look at it for one minute.",
  "Write the first sentence, badly. It only has to exist.",
  "Do the part you already know how to do. Leave the rest for now.",
  "What is the one question you would need answered? Write it down, don't answer it.",
  "Shrink the step until it takes one minute. What is left of it?",
  "Say out loud what you are about to do, then do the first ten seconds of it.",
  "Put the step in front of you: open it, or take it out. Nothing else yet.",
];

export type StuckPrompt = {
  source: "ai" | "fallback";
  text: string;
  note?: string;
};

/**
 * One prompt per tap. The `turn` is how many prompts this sprint has already
 * shown, so the plain list rotates instead of repeating.
 */
export const askForHelp = createServerFn({ method: "POST" })
  .validator((data: { sessionId: string; turn: number }) => data)
  .handler(async ({ data }): Promise<StuckPrompt> => {
    const turn =
      Number.isFinite(Number(data.turn)) && Number(data.turn) > 0
        ? Math.floor(Number(data.turn))
        : 0;
    const plain: StuckPrompt = {
      source: "fallback",
      text: PLAIN_PROMPTS[turn % PLAIN_PROMPTS.length] as string,
      note: "Not AI — one of FocusPilot's plain prompts. No model is connected.",
    };

    try {
      const user = await requireUser();
      const sql = await db();
      const rows = await sql<
        { task_id: string; task_title: string; step_text: string | null }[]
      >`
        select fs.task_id, t.title as task_title, s.text as step_text
          from focus_sessions fs
          join tasks t on t.id = fs.task_id
          left join steps s on s.id = fs.step_id
         where fs.id = ${uuid(data.sessionId)}::uuid and fs.user_id = ${user.id}
         limit 1
      `;
      const row = rows[0];
      if (!row) return plain;
      const step =
        row.step_text ??
        (await currentStep(sql, user.id, row.task_id))?.text ??
        row.task_title;
      const ai = await oneStuckPrompt(row.task_title, step);
      if (ai) {
        return {
          source: "ai",
          text: ai,
          note: "Written by AI from your task and step. Ignore it if it isn't useful.",
        };
      }
    } catch (error) {
      console.error("[focuspilot] stuck prompt fell back to plain:", error);
    }
    return plain;
  });
