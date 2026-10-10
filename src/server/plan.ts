import { createServerFn } from "@tanstack/react-start";
import { db, dbStatus } from "~/db";
import { currentUser, requireUser } from "~/server/session";
import type { NotConnected } from "~/server/auth";

/**
 * Today's plan — at most three priorities, chosen from the person's own tasks.
 *
 * Rows live in `daily_priorities` and are scoped to one day (`day = today`, the
 * database's date). Tomorrow the plan is empty again: nothing carries over and
 * nothing is "missed", so there is no streak to break and nothing to fail.
 *
 * The cap is three. It is a kindness, not a rule — the screen says so in one
 * calm line rather than lecturing.
 */

export const MAX_PRIORITIES = 3;

export type PriorityRow = {
  id: string;
  taskId: string;
  title: string;
  position: number;
  /** The task itself was marked done or archived after it was planned. */
  finished: boolean;
};

export type PlanCandidate = { id: string; title: string; openSteps: number };

export type PlanPage = NotConnected | { kind: "signed_out" } | {
  kind: "ready";
  email: string;
  priorities: PriorityRow[];
  candidates: PlanCandidate[];
  full: boolean;
  /** True when there is at least one active task to choose from. */
  hasTasks: boolean;
};

export type PlanActionResult = { ok: boolean; error?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ZERO = "00000000-0000-0000-0000-000000000000";

function uuid(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  return UUID.test(raw) ? raw : ZERO;
}

export const pagePlan = createServerFn({ method: "POST" }).handler(
  async (): Promise<PlanPage> => {
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
    const planned = await sql<
      { id: string; task_id: string; title: string; position: number; status: string }[]
    >`
      select p.id, p.task_id, t.title, p.position, t.status
        from daily_priorities p
        join tasks t on t.id = p.task_id and t.user_id = p.user_id
       where p.user_id = ${user.id} and p.day = current_date
       order by p.position asc
    `;
    const tasks = await sql<{ id: string; title: string; open_steps: number }[]>`
      select t.id,
             t.title,
             (select count(*)::int from steps s
               where s.task_id = t.id and s.done = false) as open_steps
        from tasks t
       where t.user_id = ${user.id} and t.status = 'active'
       order by t.created_at desc
    `;
    const plannedIds = new Set(planned.map((row) => row.task_id));

    return {
      kind: "ready",
      email: user.email,
      priorities: planned.map((row) => ({
        id: row.id,
        taskId: row.task_id,
        title: row.title,
        position: Number(row.position ?? 0),
        finished: row.status !== "active",
      })),
      candidates: tasks
        .filter((task) => !plannedIds.has(task.id))
        .map((task) => ({
          id: task.id,
          title: task.title,
          openSteps: Number(task.open_steps ?? 0),
        })),
      full: planned.length >= MAX_PRIORITIES,
      hasTasks: tasks.length > 0,
    };
  }
);

/** Put one of the person's own active tasks into today's plan. */
export const addPriority = createServerFn({ method: "POST" })
  .validator((data: { taskId: string }) => data)
  .handler(async ({ data }): Promise<PlanActionResult> => {
    const user = await requireUser();
    const sql = await db();
    const taskId = uuid(data.taskId);
    const owned = await sql<{ id: string }[]>`
      select id from tasks
       where id = ${taskId}::uuid and user_id = ${user.id} and status = 'active'
       limit 1
    `;
    if (!owned[0]) return { ok: false, error: "That task isn't here any more." };

    const result = await sql.begin(async (tx) => {
      const existing = await tx<{ n: number }[]>`
        select count(*)::int as n
          from daily_priorities
         where user_id = ${user.id} and day = current_date
      `;
      if (Number(existing[0]?.n ?? 0) >= MAX_PRIORITIES) {
        return {
          ok: false,
          error: "Three is today's plan already. Remove one to add another.",
        };
      }
      const already = await tx<{ id: string }[]>`
        select id from daily_priorities
         where user_id = ${user.id} and day = current_date and task_id = ${taskId}::uuid
         limit 1
      `;
      if (already[0]) return { ok: true };
      const next = await tx<{ next: number }[]>`
        select coalesce(max(position), -1) + 1 as next
          from daily_priorities
         where user_id = ${user.id} and day = current_date
      `;
      await tx`
        insert into daily_priorities (user_id, task_id, day, position)
        values (${user.id}, ${taskId}::uuid, current_date, ${Number(next[0]?.next ?? 0)})
        on conflict (user_id, day, position) do nothing
      `;
      return { ok: true };
    });
    return result;
  });

export const removePriority = createServerFn({ method: "POST" })
  .validator((data: { priorityId: string }) => data)
  .handler(async ({ data }): Promise<PlanActionResult> => {
    const user = await requireUser();
    const sql = await db();
    await sql`
      delete from daily_priorities
       where id = ${uuid(data.priorityId)}::uuid and user_id = ${user.id}
    `;
    return { ok: true };
  });
