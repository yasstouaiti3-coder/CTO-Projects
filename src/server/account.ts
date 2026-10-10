import { createServerFn } from "@tanstack/react-start";
import { db, dbStatus } from "~/db";
import { clearSessionCookie, currentUser, requireUser } from "~/server/session";
import type { NotConnected } from "~/server/auth";

/**
 * The trust commitments, as code.
 *
 * The plan promises that people can delete their tasks and their account, and
 * that FocusPilot keeps only the data it needs to run. This module is where that
 * promise is kept:
 *
 *   - `deleteMyTasks` removes the person's tasks and everything derived from
 *     them (steps, sprints, today's plan) and leaves the account itself alone.
 *   - `deleteMyAccount` removes the account row, and with it every row that
 *     belongs to that person — sessions, tasks, steps, focus_sessions,
 *     daily_priorities, reminder_settings — and signs them out.
 *
 * The child tables all declare `on delete cascade`, but both handlers delete
 * the children explicitly, inside one transaction, in dependency order. A
 * cascade that a later migration forgot to declare can then never leave an
 * orphan row behind: after either call, a query for that user id in any of those
 * tables returns nothing.
 */

export type AccountCounts = {
  tasks: number;
  steps: number;
  sprints: number;
  plannedDays: number;
  reminder: boolean;
};

export type AccountPage =
  | NotConnected
  | { kind: "signed_out" }
  | ({ kind: "ready"; email: string } & AccountCounts);

export type SimpleResult = { ok: true } | { ok: false; error: string };

const NOT_SIGNED_IN = "Please sign in again.";

export const pageAccount = createServerFn({ method: "POST" }).handler(
  async (): Promise<AccountPage> => {
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
    const rows = await sql<
      {
        tasks: number;
        steps: number;
        sprints: number;
        planned_days: number;
        reminder: boolean;
      }[]
    >`
      select
        (select count(*)::int from tasks where user_id = ${user.id}) as tasks,
        (select count(*)::int from steps where user_id = ${user.id}) as steps,
        (select count(*)::int from focus_sessions where user_id = ${user.id}) as sprints,
        (select count(*)::int from daily_priorities where user_id = ${user.id}) as planned_days,
        exists (select 1 from reminder_settings where user_id = ${user.id}) as reminder
    `;
    const row = rows[0];
    return {
      kind: "ready",
      email: user.email,
      tasks: Number(row?.tasks ?? 0),
      steps: Number(row?.steps ?? 0),
      sprints: Number(row?.sprints ?? 0),
      plannedDays: Number(row?.planned_days ?? 0),
      reminder: Boolean(row?.reminder),
    };
  }
);

/**
 * Tasks, and everything that only exists because of them. The account, the
 * sign-in and the reminder setting stay: this is "start again", not "goodbye".
 */
export const deleteMyTasks = createServerFn({ method: "POST" }).handler(
  async (): Promise<SimpleResult> => {
    let user;
    try {
      user = await requireUser();
    } catch {
      return { ok: false, error: NOT_SIGNED_IN };
    }

    try {
      const sql = await db();
      await sql.begin(async (tx) => {
        await tx`delete from focus_sessions where user_id = ${user.id}`;
        await tx`delete from daily_priorities where user_id = ${user.id}`;
        await tx`delete from steps where user_id = ${user.id}`;
        await tx`delete from tasks where user_id = ${user.id}`;
      });
      return { ok: true };
    } catch (error) {
      console.error("[focuspilot] delete-my-tasks failed:", error);
      return { ok: false, error: "Couldn't delete those just now. Try again." };
    }
  }
);

/**
 * The whole account. Every row that names this user id goes, in one
 * transaction, and the session cookie is cleared either way so the person is
 * signed out even if the database call was the part that failed.
 */
export const deleteMyAccount = createServerFn({ method: "POST" }).handler(
  async (): Promise<SimpleResult> => {
    let user;
    try {
      user = await requireUser();
    } catch {
      return { ok: false, error: NOT_SIGNED_IN };
    }

    try {
      const sql = await db();
      await sql.begin(async (tx) => {
        await tx`delete from sessions where user_id = ${user.id}`;
        await tx`delete from reminder_settings where user_id = ${user.id}`;
        await tx`delete from focus_sessions where user_id = ${user.id}`;
        await tx`delete from daily_priorities where user_id = ${user.id}`;
        await tx`delete from steps where user_id = ${user.id}`;
        await tx`delete from tasks where user_id = ${user.id}`;
        await tx`delete from users where id = ${user.id}`;
      });
      return { ok: true };
    } catch (error) {
      console.error("[focuspilot] delete-my-account failed:", error);
      return { ok: false, error: "Couldn't delete the account just now. Try again." };
    } finally {
      // The account row is gone, so the cookie must go too.
      try {
        clearSessionCookie();
      } catch (error) {
        console.error("[focuspilot] could not clear session cookie:", error);
      }
    }
  }
);
