import { useState } from "react";
import { Link, createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import {
  deleteMyAccount,
  deleteMyTasks,
  pageAccount,
} from "~/server/account";
import { SignOutButton } from "~/components/SignOutButton";
import {
  Hint,
  NotConnected,
  Shell,
  ScreenTitle,
  primaryButton,
  quietButton,
  secondaryButton,
} from "~/components/Shell";

/**
 * The account surface — where the promises are kept.
 *
 * Two honest actions and nothing else: delete what you added, or delete the
 * whole account. Each one asks once, says plainly what will be lost, and always
 * leaves a way to back out. No typing a word to prove intent, no countdown, no
 * "are you sure?" repeated, and nothing is mentioned again afterwards.
 */

export const Route = createFileRoute("/account")({
  loader: async () => {
    const data = await pageAccount();
    if (data.kind === "signed_out") throw redirect({ to: "/login" });
    return data;
  },
  component: AccountPage,
});

function AccountPage() {
  const data = Route.useLoaderData();
  if (data.kind === "not_connected") {
    return <NotConnected reason={data.reason} />;
  }
  return (
    <Account
      email={data.email}
      tasks={data.tasks}
      steps={data.steps}
      sprints={data.sprints}
      plannedDays={data.plannedDays}
      reminder={data.reminder}
    />
  );
}

/** "3 tasks, 7 steps and 2 sprints" — no Oxford comma theatre, no zeros listed. */
function listOf(parts: string[]): string {
  if (parts.length === 0) return "nothing";
  if (parts.length === 1) return parts[0] as string;
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function Account({
  email,
  tasks,
  steps,
  sprints,
  plannedDays,
  reminder,
}: {
  email: string;
  tasks: number;
  steps: number;
  sprints: number;
  plannedDays: number;
  reminder: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState<"none" | "tasks" | "account">("none");
  const [cleared, setCleared] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stored = listOf([
    count(tasks, "task", "tasks"),
    count(steps, "step", "steps"),
    count(sprints, "sprint", "sprints"),
    count(plannedDays, "planned day", "planned days"),
  ]);

  const nothingStored =
    tasks === 0 && steps === 0 && sprints === 0 && plannedDays === 0;

  async function removeTasks() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await deleteMyTasks();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setAsking("none");
      setCleared(true);
      await router.invalidate();
    } catch {
      setError("That didn't go through. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function removeAccount() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await deleteMyAccount();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Signed out and gone: a plain landing page, and nothing said afterwards.
      window.location.assign("/");
    } catch {
      setError("That didn't go through. Try again.");
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
          <ScreenTitle>Your account</ScreenTitle>
          <Hint>
            FocusPilot keeps your email and password, your tasks and steps, the
            sprints you run, today&rsquo;s plan and your reminder setting. Nothing
            else — no contacts, no tracking, no third parties.
          </Hint>
        </div>

        <section className="space-y-3">
          <h2 className="text-xs font-medium tracking-wide text-stone-400 uppercase">
            Stored right now
          </h2>
          <p className="rounded-2xl border border-stone-200 bg-white px-4 py-3.5 text-sm leading-relaxed text-stone-700">
            {nothingStored ? "Nothing yet. " : `${stored}. `}
            <span className="text-stone-500">
              Reminder {reminder ? "on" : "off"}.
            </span>
          </p>
          {cleared ? (
            <p className="text-sm text-stone-500">
              Deleted. Your tasks, steps, sprints and plan are gone; your account
              is still here.
            </p>
          ) : null}
        </section>

        <section className="space-y-3 border-t border-stone-200 pt-7">
          <h2 className="text-xs font-medium tracking-wide text-stone-400 uppercase">
            Delete what you added
          </h2>
          <Hint>
            Your tasks, their steps, the sprints on them and your planned days
            all go. Your account and how you sign in stay, so you can start
            again.
          </Hint>

          {asking === "tasks" ? (
            <div className="space-y-4 rounded-2xl border border-stone-200 bg-white px-5 py-5">
              <p className="text-sm leading-relaxed text-stone-800">
                {nothingStored
                  ? "There's nothing stored to delete."
                  : `This removes ${stored}. It can't be undone.`}
              </p>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                <button
                  type="button"
                  disabled={busy || nothingStored}
                  onClick={() => void removeTasks()}
                  className={primaryButton}
                >
                  {busy ? "Deleting…" : "Delete them"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setAsking("none");
                  }}
                  className={quietButton}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={busy || nothingStored}
              onClick={() => {
                setCleared(false);
                setError(null);
                setAsking("tasks");
              }}
              className={secondaryButton}
            >
              Delete my tasks and sprints
            </button>
          )}
        </section>

        <section className="space-y-3 border-t border-stone-200 pt-7">
          <h2 className="text-xs font-medium tracking-wide text-stone-400 uppercase">
            Delete your account
          </h2>
          <Hint>
            Everything above, plus your account itself, your sign-in and your
            reminder setting. You&rsquo;ll be signed out, and this email address
            won&rsquo;t have an account any more — you can make a new one
            whenever you like.
          </Hint>

          {asking === "account" ? (
            <div className="space-y-4 rounded-2xl border border-stone-200 bg-white px-5 py-5">
              <p className="text-sm leading-relaxed text-stone-800">
                This deletes the account {email}
                {nothingStored
                  ? " and its sign-in and reminder setting."
                  : ` and everything in it — ${stored}, plus the sign-in and the reminder setting.`}{" "}
                It can&rsquo;t be undone.
              </p>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void removeAccount()}
                  className={primaryButton}
                >
                  {busy ? "Deleting…" : "Delete everything"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setAsking("none");
                  }}
                  className={quietButton}
                >
                  Keep my account
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setCleared(false);
                setError(null);
                setAsking("account");
              }}
              className={secondaryButton}
            >
              Delete my account
            </button>
          )}
        </section>

        {error ? <p className="text-sm text-red-700">{error}</p> : null}
      </div>
    </Shell>
  );
}
