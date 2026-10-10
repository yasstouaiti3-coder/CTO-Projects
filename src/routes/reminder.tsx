import { useState } from "react";
import {
  Link,
  createFileRoute,
  redirect,
  useRouter,
} from "@tanstack/react-router";
import { pageReminder, saveReminder } from "~/server/reminder";
import type { ReminderPreference } from "~/server/reminder";
import { SignOutButton } from "~/components/SignOutButton";
import {
  Hint,
  NotConnected,
  Shell,
  ScreenTitle,
  inputClass,
  primaryButton,
  quietButton,
} from "~/components/Shell";

export const Route = createFileRoute("/reminder")({
  loader: async () => {
    const data = await pageReminder();
    if (data.kind === "signed_out") throw redirect({ to: "/login" });
    return data;
  },
  component: ReminderPage,
});

function ReminderPage() {
  const data = Route.useLoaderData();
  if (data.kind === "not_connected") {
    return <NotConnected reason={data.reason} />;
  }
  return <Reminder reminder={data.reminder} />;
}

function Reminder({ reminder }: { reminder: ReminderPreference }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(reminder.enabled);
  const [time, setTime] = useState(reminder.time);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const result = await saveReminder({ data: { enabled, time } });
      if (!result.ok) {
        setError(result.error ?? "That didn't save. Try again.");
        return;
      }
      setSaved(true);
      await router.invalidate();
    } catch {
      setError("That didn't go through. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell right={<SignOutButton />}>
      <div className="space-y-9">
        <Link to="/tasks" className={quietButton}>
          &larr; Your tasks
        </Link>

        <div className="space-y-3">
          <ScreenTitle>Reminder</ScreenTitle>
          <Hint>Optional. Off unless you turn it on.</Hint>
        </div>

        <form onSubmit={save} className="space-y-6">
          <label className="flex items-start gap-3 rounded-2xl border border-stone-200 bg-white px-4 py-4">
            <input
              type="checkbox"
              name="enabled"
              checked={enabled}
              onChange={(event) => {
                setEnabled(event.target.checked);
                setSaved(false);
              }}
              className="mt-0.5 size-4 shrink-0 accent-stone-800"
            />
            <span className="text-[0.95rem] leading-snug text-stone-800">
              Remind me once a day, inside FocusPilot
            </span>
          </label>

          <div className="space-y-2">
            <label
              htmlFor="reminder-time"
              className="block text-sm text-stone-600"
            >
              Reminder time
            </label>
            <input
              id="reminder-time"
              type="time"
              name="time"
              value={time}
              onChange={(event) => {
                setTime(event.target.value);
                setSaved(false);
              }}
              className={`${inputClass} max-w-[10rem]`}
            />
            <p className="text-xs leading-relaxed text-stone-400">
              Your own clock — FocusPilot doesn&rsquo;t know your timezone, so it
              compares this with the time in your browser.
            </p>
          </div>

          <p className="rounded-2xl border border-stone-200 bg-stone-100 px-4 py-3.5 text-sm leading-relaxed text-stone-600">
            Be clear about what this can do: FocusPilot has no email service and
            no push notifications, so nothing can reach you while it&rsquo;s
            closed. An enabled reminder shows one quiet line on this app the next
            time you open it after your chosen time, once a day.
          </p>

          <div className="flex flex-wrap items-center gap-4">
            <button type="submit" disabled={busy} className={primaryButton}>
              {busy ? "Saving…" : "Save"}
            </button>
            {saved ? (
              <p className="text-sm text-stone-500">Saved.</p>
            ) : null}
            {error ? <p className="text-sm text-red-700">{error}</p> : null}
          </div>
        </form>
      </div>
    </Shell>
  );
}
