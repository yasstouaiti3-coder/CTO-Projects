import { useEffect, useState } from "react";
import {
  Link,
  createFileRoute,
  redirect,
  useRouter,
} from "@tanstack/react-router";
import { addTask, deleteTask, pageTasks, setTaskStatus } from "~/server/tasks";
import type { TaskRow } from "~/server/tasks";
import { pagePlan } from "~/server/plan";
import type { PriorityRow } from "~/server/plan";
import { pageReminder } from "~/server/reminder";
import type { ReminderPreference } from "~/server/reminder";
import { SignOutButton } from "~/components/SignOutButton";
import { ReminderLine } from "~/components/ReminderLine";
import {
  Hint,
  NotConnected,
  Shell,
  inputClass,
  primaryButton,
  quietButton,
} from "~/components/Shell";

export const Route = createFileRoute("/tasks")({
  loader: async () => {
    const [tasks, plan, reminder] = await Promise.all([
      pageTasks(),
      pagePlan(),
      pageReminder(),
    ]);
    if (tasks.kind === "signed_out") throw redirect({ to: "/login" });
    return { tasks, plan, reminder };
  },
  component: TasksPage,
});

function TasksPage() {
  const data = Route.useLoaderData();
  if (data.tasks.kind === "not_connected") {
    return <NotConnected reason={data.tasks.reason} />;
  }
  return (
    <Inbox
      email={data.tasks.email}
      tasks={data.tasks.tasks}
      plan={data.plan.kind === "ready" ? data.plan.priorities : []}
      reminder={data.reminder.kind === "ready" ? data.reminder.reminder : null}
    />
  );
}

function Inbox({
  email,
  tasks,
  plan,
  reminder,
}: {
  email: string;
  tasks: TaskRow[];
  plan: PriorityRow[];
  reminder: ReminderPreference | null;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const active = tasks.filter((task) => task.status === "active");
  const done = tasks.filter((task) => task.status === "done");
  const archived = tasks.filter((task) => task.status === "archived");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await addTask({ data: { title: trimmed } });
      if (!result.ok) {
        setError(result.error ?? "Couldn't add that. Try again.");
        return;
      }
      setTitle("");
      await router.invalidate();
    } catch {
      setError("Couldn't add that. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell
      right={
        <nav className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
          <Link to="/progress" className={quietButton}>
            Progress
          </Link>
          <Link to="/reminder" className={quietButton}>
            Reminder
          </Link>
          <Link to="/account" className={quietButton}>
            Account
          </Link>
          <SignOutButton />
        </nav>
      }
    >
      <div className="space-y-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold text-stone-900">Your tasks</h1>
          <Hint>Messy is fine. One line is enough.</Hint>
        </div>

        {reminder ? <ReminderLine reminder={reminder} /> : null}

        <Today plan={plan} />

        <form onSubmit={submit} className="space-y-3">
          <input
            type="text"
            name="title"
            value={title}
            placeholder="What do you keep avoiding?"
            onChange={(event) => {
              setTitle(event.target.value);
            }}
            className={inputClass}
            maxLength={300}
          />
          <div className="flex items-center gap-4">
            <button
              type="submit"
              disabled={busy || title.trim().length === 0}
              className={primaryButton}
            >
              {busy ? "Adding…" : "Add task"}
            </button>
            {error ? <p className="text-sm text-red-700">{error}</p> : null}
          </div>
        </form>

        {active.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-stone-300 px-5 py-6">
            <p className="text-sm leading-relaxed text-stone-500">
              {tasks.length === 0
                ? "Nothing here yet. Add one thing — the one that's been sitting there."
                : "Nothing active right now."}
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {active.map((task) => (
              <TaskListItem key={task.id} task={task} />
            ))}
          </ul>
        )}

        {done.length > 0 ? (
          <section className="space-y-3">
            <h2 className="text-xs font-medium tracking-wide text-stone-400 uppercase">
              Done
            </h2>
            <ul className="space-y-3">
              {done.map((task) => (
                <TaskListItem key={task.id} task={task} />
              ))}
            </ul>
          </section>
        ) : null}

        {archived.length > 0 ? (
          <section className="space-y-3">
            <h2 className="text-xs font-medium tracking-wide text-stone-400 uppercase">
              Archived
            </h2>
            <ul className="space-y-3">
              {archived.map((task) => (
                <TaskListItem key={task.id} task={task} />
              ))}
            </ul>
          </section>
        ) : null}

        <p className="text-xs text-stone-400">Signed in as {email}.</p>
      </div>
    </Shell>
  );
}

/**
 * Today's plan, kept quiet: at most three lines at the top of the list, and one
 * link to the page where they are chosen. No card, no progress bar, no score.
 */
function Today({ plan }: { plan: PriorityRow[] }) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-xs font-medium tracking-wide text-stone-400 uppercase">
          Today
        </h2>
        <Link to="/plan" className={`${quietButton} text-xs`}>
          {plan.length === 0 ? "Plan today" : "Change"}
        </Link>
      </div>
      {plan.length === 0 ? (
        <p className="text-sm leading-relaxed text-stone-500">
          Nothing planned for today. Up to three is plenty.
        </p>
      ) : (
        <ol className="space-y-2">
          {plan.map((priority, index) => (
            <li key={priority.id} className="flex items-baseline gap-3">
              <span className="text-sm text-stone-400 tabular-nums">
                {index + 1}
              </span>
              <Link
                to="/tasks/$taskId"
                params={{ taskId: priority.taskId }}
                className={`text-[0.95rem] leading-snug no-underline ${
                  priority.finished ? "text-stone-400 line-through" : "text-stone-800"
                }`}
              >
                {priority.title}
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function TaskListItem({ task }: { task: TaskRow }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // Read the clock after mount only: the server has a different `now`, and a
  // mismatch here would be a hydration error rather than useful information.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 15_000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  const sprint = task.sprint;
  // The server decides whether the clock is still ticking; the local clock only
  // updates the words when the timer runs out while this page is open.
  const sprintOver =
    sprint !== null &&
    (!sprint.running ||
      (now !== null &&
        now >= Date.parse(sprint.startedAt) + sprint.plannedMinutes * 60_000));

  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    try {
      await work();
      await router.invalidate();
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  const titleClass =
    task.status === "done"
      ? "text-stone-400 line-through"
      : task.status === "archived"
        ? "text-stone-400"
        : "text-stone-800";

  return (
    <li className="rounded-2xl border border-stone-200 bg-white px-4 py-3.5">
      <Link
        to="/tasks/$taskId"
        params={{ taskId: task.id }}
        className={`block text-[0.95rem] leading-snug no-underline ${titleClass}`}
      >
        {task.title}
      </Link>

      {sprint ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-stone-100 px-3 py-2">
          <span className="text-xs text-stone-600">
            {sprintOver ? "Sprint finished" : "Sprint running"}
          </span>
          <Link
            to="/focus/$sessionId"
            params={{ sessionId: sprint.sessionId }}
            className={`${quietButton} text-xs`}
          >
            {sprintOver ? "Wrap it up" : "Return to sprint"}
          </Link>
        </div>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-stone-500">
        {task.status === "active" ? (
          <button
            type="button"
            disabled={busy}
            className={quietButton}
            onClick={() =>
              run(() =>
                setTaskStatus({ data: { taskId: task.id, status: "done" } })
              )
            }
          >
            Mark done
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            className={quietButton}
            onClick={() =>
              run(() =>
                setTaskStatus({ data: { taskId: task.id, status: "active" } })
              )
            }
          >
            Reopen
          </button>
        )}

        {task.status === "archived" ? (
          <button
            type="button"
            disabled={busy}
            className={quietButton}
            onClick={() =>
              run(() =>
                setTaskStatus({ data: { taskId: task.id, status: "active" } })
              )
            }
          >
            Unarchive
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            className={quietButton}
            onClick={() =>
              run(() =>
                setTaskStatus({ data: { taskId: task.id, status: "archived" } })
              )
            }
          >
            Archive
          </button>
        )}

        {task.step_count > 0 ? (
          <span className="text-stone-400">
            {task.step_count} {task.step_count === 1 ? "step" : "steps"}
          </span>
        ) : null}

        <button
          type="button"
          disabled={busy}
          className={quietButton}
          onClick={() => {
            if (!confirming) {
              setConfirming(true);
              return;
            }
            void run(() => deleteTask({ data: { taskId: task.id } }));
          }}
        >
          {confirming ? "Tap again to delete" : "Delete"}
        </button>
      </div>
    </li>
  );
}
