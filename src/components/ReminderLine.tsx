import { useEffect, useRef, useState } from "react";
import { markReminderShown } from "~/server/reminder";
import type { ReminderPreference } from "~/server/reminder";
import { quietButton } from "~/components/Shell";

/**
 * The reminder, exactly as honest as it can be: it has no way to reach anyone
 * while FocusPilot is closed, so it is one quiet line inside the app, shown once
 * on the first visit after the person's chosen time.
 *
 * The clock is read after mount (never during render) because the server's time
 * and the person's local time are different things.
 */

function localDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${String(date.getFullYear())}-${month}-${day}`;
}

function minutesOfDay(value: string): number | null {
  const match = /^([01][0-9]|2[0-3]):([0-5][0-9])$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function ReminderLine({ reminder }: { reminder: ReminderPreference }) {
  const [now, setNow] = useState<Date | null>(null);
  const [hidden, setHidden] = useState(false);
  const marked = useRef(false);

  useEffect(() => {
    setNow(new Date());
  }, []);

  const today = now ? localDay(now) : null;
  const target = minutesOfDay(reminder.time);
  const due =
    reminder.enabled &&
    now !== null &&
    today !== null &&
    reminder.lastShownOn !== today &&
    target !== null &&
    now.getHours() * 60 + now.getMinutes() >= target;

  useEffect(() => {
    if (!due || marked.current || !today) return;
    marked.current = true;
    void markReminderShown({ data: { day: today } }).catch(() => {
      // A quiet line is never worth an error message.
    });
  }, [due, today]);

  if (!due || now === null || hidden) return null;

  return (
    <div className="space-y-2 rounded-2xl border border-stone-200 bg-white px-4 py-3.5">
      <p className="text-sm leading-relaxed text-stone-600">
        You asked to be reminded at {reminder.time}. This is that reminder — it
        can only appear here, when you open FocusPilot. One task and one short
        sprint is a fine place to start.
      </p>
      <button
        type="button"
        className={`${quietButton} text-xs`}
        onClick={() => {
          setHidden(true);
        }}
      >
        Hide
      </button>
    </div>
  );
}
