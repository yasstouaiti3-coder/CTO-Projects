import { createServerFn } from "@tanstack/react-start";
import { db, dbStatus } from "~/db";
import { currentUser } from "~/server/session";
import type { NotConnected } from "~/server/auth";

/**
 * Progress — plain reassurance, not a scoreboard.
 *
 * Two numbers, both of them the person's own: how many sprints they started and
 * how many they finished (finished = they told us what happened, whether that
 * was done, partly or stuck). No streaks, no badges, no comparisons, no colour
 * that reads as pass or fail.
 */

export type ProgressPage = NotConnected | { kind: "signed_out" } | {
  kind: "ready";
  email: string;
  started: number;
  finished: number;
};

export const pageProgress = createServerFn({ method: "POST" }).handler(
  async (): Promise<ProgressPage> => {
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
    // `finished` counts the sprints the person accounted for, not the ones that
    // merely got closed: a sprint that ran out of time is closed automatically
    // with `outcome` still null, and the page promises the second number only
    // counts sprints they said something about. Counting `ended_at` would claim
    // more than the words support.
    const rows = await sql<{ started: number; finished: number }[]>`
      select count(*)::int as started,
             count(outcome)::int as finished
        from focus_sessions
       where user_id = ${user.id}
    `;
    const row = rows[0];
    return {
      kind: "ready",
      email: user.email,
      started: Number(row?.started ?? 0),
      finished: Number(row?.finished ?? 0),
    };
  }
);
