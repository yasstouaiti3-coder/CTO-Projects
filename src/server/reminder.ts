import { createServerFn } from "@tanstack/react-start";
import { db, dbStatus } from "~/db";
import { currentUser, requireUser } from "~/server/session";
import type { NotConnected } from "~/server/auth";

/**
 * The optional reminder — off unless the person turns it on.
 *
 * What it honestly can do: FocusPilot has no email service and no push service,
 * so nothing can reach anyone while the app is closed. An enabled reminder is
 * therefore only ever a quiet line *inside* the app: the first time the person
 * opens FocusPilot after their chosen time, that day, they see one sentence at
 * the top of their tasks. Dismissing it records the date so it does not nag
 * again that day.
 *
 * The chosen time is read against the *person's* clock in the browser (the
 * server has no idea what timezone they are in), so only the preference and the
 * "last shown" date live in the database.
 */

export type ReminderPreference = {
  enabled: boolean;
  /** 'HH:MM', 24-hour. */
  time: string;
  /** 'YYYY-MM-DD' in the person's own local time, or null. */
  lastShownOn: string | null;
};

export type ReminderPage = NotConnected | { kind: "signed_out" } | {
  kind: "ready";
  email: string;
  reminder: ReminderPreference;
};

const DEFAULT_TIME = "09:00";
const TIME_PATTERN = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function cleanTime(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  return TIME_PATTERN.test(raw) ? raw : DEFAULT_TIME;
}

function cleanDay(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  return DAY_PATTERN.test(raw) ? raw : null;
}

export const pageReminder = createServerFn({ method: "POST" }).handler(
  async (): Promise<ReminderPage> => {
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
      { enabled: boolean; at_time: string; last_shown_on: Date | null }[]
    >`
      select enabled, at_time, last_shown_on
        from reminder_settings
       where user_id = ${user.id}
       limit 1
    `;
    const row = rows[0];
    return {
      kind: "ready",
      email: user.email,
      reminder: {
        enabled: Boolean(row?.enabled ?? false),
        time: TIME_PATTERN.test(String(row?.at_time ?? ""))
          ? String(row.at_time)
          : DEFAULT_TIME,
        lastShownOn: row?.last_shown_on
          ? String(row.last_shown_on).slice(0, 10)
          : null,
      },
    };
  }
);

export const saveReminder = createServerFn({ method: "POST" })
  .validator((data: { enabled: boolean; time: string }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean; error?: string }> => {
    const user = await requireUser();
    const sql = await db();
    const enabled = Boolean(data.enabled);
    const time = cleanTime(data.time);
    await sql`
      insert into reminder_settings (user_id, enabled, at_time, updated_at)
      values (${user.id}, ${enabled}, ${time}, now())
      on conflict (user_id) do update
        set enabled = ${enabled},
            at_time = ${time},
            -- Turning it off, or moving the time, starts the day fresh.
            last_shown_on = null,
            updated_at = now()
    `;
    return { ok: true };
  });

/** Remember that today's quiet line was shown (or dismissed), in local time. */
export const markReminderShown = createServerFn({ method: "POST" })
  .validator((data: { day: string }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const day = cleanDay(data.day);
    if (!day) return { ok: false };
    const user = await requireUser();
    const sql = await db();
    await sql`
      update reminder_settings
         set last_shown_on = ${day}::date
       where user_id = ${user.id}
    `;
    return { ok: true };
  });
