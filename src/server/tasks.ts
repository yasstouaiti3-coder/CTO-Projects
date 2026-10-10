import { createServerFn } from "@tanstack/react-start";
import { db, dbStatus, iso } from "~/db";
import { currentUser, requireUser } from "~/server/session";
import type { NotConnected } from "~/server/auth";
import type { OpenSprint } from "~/server/focus";

/**
 * Task inbox + steps. Every query is scoped by user_id: a task id from the URL
 * is never trusted on its own.
 */

export type TaskStatus = "active" | "done" | "archived";

export type TaskRow = {
  id: string;
  title: string;
  status: TaskStatus;
  created_at: string;
  step_count: number;
  /** A sprint with no `ended_at` on this task — shown on the task and the inbox. */
  sprint: OpenSprint | null;
};

/**
 * What the task queries actually select: the shape above plus the open sprint
 * columns from the lateral join (mapped into `sprint` before it leaves here).
 */
type TaskDbRow = TaskRow & {
  sprint_id: string | null;
  sprint_minutes: number | null;
  sprint_started: Date | null;
  sprint_running: boolean | null;
};

export type StepRow = {
  id: string;
  text: string;
  position: number;
  source: string;
  done: boolean;
};

export type TasksPage = NotConnected | { kind: "signed_out" } | {
  kind: "ready";
  email: string;
  tasks: TaskRow[];
};

export type TaskPage = NotConnected | { kind: "signed_out" } | {
  kind: "missing";
} | {
  kind: "ready";
  email: string;
  task: TaskRow;
  steps: StepRow[];
};

const MAX_TITLE = 300;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function id(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  // Never hand a non-uuid to Postgres: it would throw instead of "not found".
  return UUID.test(raw) ? raw : "00000000-0000-0000-0000-000000000000";
}

function cleanText(value: unknown, max = MAX_TITLE): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export const pageTasks = createServerFn({ method: "POST" }).handler(
  async (): Promise<TasksPage> => {
    const status = await dbStatus();
    if (!status.ok) {
      return {
        kind: "not_connected",
        reason: status.reason,
        message: status.message,
      };
    }
    const user = await currentUser();
    if (!user) return { kind: "signed_out" };

    const sql = await db();
    const rows = await sql<TaskDbRow[]>`
      select t.id,
             t.title,
             t.status,
             t.created_at,
             (select count(*)::int from steps s where s.task_id = t.id) as step_count,
             open.id as sprint_id,
             open.planned_minutes as sprint_minutes,
             open.started_at as sprint_started,
             open.running as sprint_running
        from tasks t
        left join lateral (
          select fs.id, fs.planned_minutes, fs.started_at,
                 (fs.started_at + (fs.planned_minutes * interval '1 minute')) > now()
                   as running
            from focus_sessions fs
           where fs.user_id = t.user_id and fs.task_id = t.id and fs.ended_at is null
           order by fs.started_at desc
           limit 1
        ) open on true
       where t.user_id = ${user.id}
       order by case t.status when 'active' then 0 when 'done' then 1 else 2 end,
                t.created_at desc
    `;
    return {
      kind: "ready",
      email: user.email,
      tasks: rows.map((row) => ({
        id: row.id,
        title: row.title,
        status: row.status,
        created_at: String(row.created_at),
        step_count: Number(row.step_count ?? 0),
        sprint: row.sprint_id
          ? {
              sessionId: row.sprint_id,
              plannedMinutes: Number(row.sprint_minutes ?? 0),
              startedAt: iso(row.sprint_started),
              running: Boolean(row.sprint_running),
            }
          : null,
      })),
    };
  }
);

export const pageTask = createServerFn({ method: "POST" })
  .validator((data: { taskId: string }) => data)
  .handler(async ({ data }): Promise<TaskPage> => {
    const status = await dbStatus();
    if (!status.ok) {
      return {
        kind: "not_connected",
        reason: status.reason,
        message: status.message,
      };
    }
    const user = await currentUser();
    if (!user) return { kind: "signed_out" };

    const sql = await db();
    const taskId = id(data.taskId);
    const tasks = await sql<TaskDbRow[]>`
      select t.id, t.title, t.status, t.created_at,
             (select count(*)::int from steps s where s.task_id = t.id) as step_count,
             open.id as sprint_id,
             open.planned_minutes as sprint_minutes,
             open.started_at as sprint_started,
             open.running as sprint_running
        from tasks t
        left join lateral (
          select fs.id, fs.planned_minutes, fs.started_at,
                 (fs.started_at + (fs.planned_minutes * interval '1 minute')) > now()
                   as running
            from focus_sessions fs
           where fs.user_id = t.user_id and fs.task_id = t.id and fs.ended_at is null
           order by fs.started_at desc
           limit 1
        ) open on true
       where t.id = ${taskId}::uuid and t.user_id = ${user.id}
       limit 1
    `;
    const task = tasks[0];
    if (!task) return { kind: "missing" };

    const steps = await sql<StepRow[]>`
      select id, text, position, source, done
        from steps
       where task_id = ${task.id} and user_id = ${user.id}
       order by position asc, created_at asc
    `;
    return {
      kind: "ready",
      email: user.email,
      task: {
        id: task.id,
        title: task.title,
        status: task.status,
        created_at: String(task.created_at),
        step_count: steps.length,
        sprint: task.sprint_id
          ? {
              sessionId: task.sprint_id,
              plannedMinutes: Number(task.sprint_minutes ?? 0),
              startedAt: iso(task.sprint_started),
              running: Boolean(task.sprint_running),
            }
          : null,
      },
      steps: steps.map((step) => ({
        id: step.id,
        text: step.text,
        position: Number(step.position ?? 0),
        source: step.source,
        done: Boolean(step.done),
      })),
    };
  });

export const addTask = createServerFn({ method: "POST" })
  .validator((data: { title: string }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean; error?: string }> => {
    const title = cleanText(data.title);
    if (!title) return { ok: false, error: "Add a few words first." };
    const user = await requireUser();
    const sql = await db();
    await sql`
      insert into tasks (user_id, title)
      values (${user.id}, ${title})
    `;
    return { ok: true };
  });

export const renameTask = createServerFn({ method: "POST" })
  .validator((data: { taskId: string; title: string }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean; error?: string }> => {
    const title = cleanText(data.title);
    if (!title) return { ok: false, error: "A task needs a few words." };
    const user = await requireUser();
    const sql = await db();
    await sql`
      update tasks
         set title = ${title}, updated_at = now()
       where id = ${id(data.taskId)}::uuid and user_id = ${user.id}
    `;
    return { ok: true };
  });

export const setTaskStatus = createServerFn({ method: "POST" })
  .validator((data: { taskId: string; status: TaskStatus }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const status: TaskStatus =
      data.status === "done" || data.status === "archived"
        ? data.status
        : "active";
    const user = await requireUser();
    const sql = await db();
    await sql`
      update tasks
         set status = ${status},
             completed_at = case when ${status} = 'done' then now() else null end,
             archived_at = case when ${status} = 'archived' then now() else null end,
             updated_at = now()
       where id = ${id(data.taskId)}::uuid and user_id = ${user.id}
    `;
    return { ok: true };
  });

export const deleteTask = createServerFn({ method: "POST" })
  .validator((data: { taskId: string }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const user = await requireUser();
    const sql = await db();
    await sql`
      delete from tasks
       where id = ${id(data.taskId)}::uuid and user_id = ${user.id}
    `;
    return { ok: true };
  });

/** Only the steps the person accepted are stored. */
export const addSteps = createServerFn({ method: "POST" })
  .validator(
    (data: { taskId: string; steps: string[]; source: string }) => data
  )
  .handler(async ({ data }): Promise<{ ok: boolean; error?: string }> => {
    const texts = (Array.isArray(data.steps) ? data.steps : [])
      .map((step) => cleanText(step))
      .filter(Boolean)
      .slice(0, 12);
    if (texts.length === 0) return { ok: false, error: "Nothing to add." };

    const user = await requireUser();
    const sql = await db();
    const taskId = id(data.taskId);
    const owned = await sql<{ id: string }[]>`
      select id from tasks where id = ${taskId}::uuid and user_id = ${user.id} limit 1
    `;
    if (!owned[0]) return { ok: false, error: "That task is no longer here." };

    const source = data.source === "ai" || data.source === "fallback"
      ? data.source
      : "manual";

    await sql.begin(async (tx) => {
      const existing = await tx<{ next: number }[]>`
        select coalesce(max(position), -1) + 1 as next
          from steps where task_id = ${taskId}::uuid
      `;
      let position = Number(existing[0]?.next ?? 0);
      for (const text of texts) {
        await tx`
          insert into steps (task_id, user_id, text, source, position)
          values (${taskId}::uuid, ${user.id}, ${text}, ${source}, ${position})
        `;
        position += 1;
      }
    });
    return { ok: true };
  });

export const updateStep = createServerFn({ method: "POST" })
  .validator((data: { stepId: string; text: string }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean; error?: string }> => {
    const text = cleanText(data.text);
    const user = await requireUser();
    const sql = await db();
    if (!text) {
      await sql`
        delete from steps
         where id = ${id(data.stepId)}::uuid and user_id = ${user.id}
      `;
      return { ok: true };
    }
    await sql`
      update steps
         set text = ${text}, updated_at = now()
       where id = ${id(data.stepId)}::uuid and user_id = ${user.id}
    `;
    return { ok: true };
  });

/**
 * Marking a step done is what advances the task: the sprint always runs on the
 * first step that is not done yet. `done: false` puts it back.
 */
export const setStepDone = createServerFn({ method: "POST" })
  .validator((data: { stepId: string; done: boolean }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const user = await requireUser();
    const sql = await db();
    await sql`
      update steps
         set done = ${Boolean(data.done)}, updated_at = now()
       where id = ${id(data.stepId)}::uuid and user_id = ${user.id}
    `;
    return { ok: true };
  });

export const deleteStep = createServerFn({ method: "POST" })
  .validator((data: { stepId: string }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const user = await requireUser();
    const sql = await db();
    await sql`
      delete from steps
       where id = ${id(data.stepId)}::uuid and user_id = ${user.id}
    `;
    return { ok: true };
  });
