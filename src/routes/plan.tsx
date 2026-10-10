import { useState } from "react";
import { Link, createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import {
  MAX_PRIORITIES,
  addPriority,
  pagePlan,
  removePriority,
} from "~/server/plan";
import { SignOutButton } from "~/components/SignOutButton";
import {
  Hint,
  NotConnected,
  Shell,
  ScreenTitle,
  quietButton,
  secondaryButton,
} from "~/components/Shell";

export const Route = createFileRoute("/plan")({
  loader: async () => {
    const data = await pagePlan();
    if (data.kind === "signed_out") throw redirect({ to: "/login" });
    return data;
  },
  component: PlanPage,
});

function PlanPage() {
  const data = Route.useLoaderData();
  if (data.kind === "not_connected") {
    return <NotConnected reason={data.reason} />;
  }
  return (
    <Plan
      priorities={data.priorities}
      candidates={data.candidates}
      full={data.full}
      hasTasks={data.hasTasks}
    />
  );
}

function Plan({
  priorities,
  candidates,
  full,
  hasTasks,
}: {
  priorities: { id: string; taskId: string; title: string; finished: boolean }[];
  candidates: { id: string; title: string; openSteps: number }[];
  full: boolean;
  hasTasks: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(work: () => Promise<{ ok: boolean; error?: string }>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await work();
      if (!result.ok) {
        setError(result.error ?? "That didn't work. Try again.");
        return;
      }
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
          <ScreenTitle>Today&rsquo;s plan</ScreenTitle>
          <Hint>Up to three. Pick what would make today feel finished.</Hint>
        </div>

        {priorities.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-stone-300 px-5 py-6">
            <p className="text-sm leading-relaxed text-stone-500">
              Nothing planned yet today. Choose one thing to start with.
            </p>
          </div>
        ) : (
          <ol className="space-y-3">
            {priorities.map((priority, index) => (
              <li
                key={priority.id}
                className="flex items-start gap-3 rounded-2xl border border-stone-200 bg-white px-4 py-3.5"
              >
                <span className="pt-0.5 text-sm text-stone-400 tabular-nums">
                  {index + 1}
                </span>
                <span
                  className={`flex-1 text-[0.95rem] leading-snug ${
                    priority.finished ? "text-stone-400 line-through" : "text-stone-800"
                  }`}
                >
                  {priority.title}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  className={`${quietButton} text-xs`}
                  onClick={() =>
                    void run(() =>
                      removePriority({ data: { priorityId: priority.id } })
                    )
                  }
                >
                  Remove
                </button>
              </li>
            ))}
          </ol>
        )}

        {priorities.length > 0 && priorities.length < MAX_PRIORITIES ? (
          <p className="text-sm text-stone-500">
            {MAX_PRIORITIES - priorities.length === 1
              ? "Room for one more."
              : `Room for ${MAX_PRIORITIES - priorities.length} more.`}
          </p>
        ) : null}

        {full ? (
          <p className="rounded-2xl border border-stone-200 bg-stone-100 px-4 py-3 text-sm leading-relaxed text-stone-600">
            That&rsquo;s the three for today. Remove one to swap something in.
          </p>
        ) : (
          <section className="space-y-3">
            <h2 className="text-xs font-medium tracking-wide text-stone-400 uppercase">
              Add one of your tasks
            </h2>
            {candidates.length === 0 ? (
              <p className="text-sm leading-relaxed text-stone-500">
                {hasTasks
                  ? "Every task you're working on is already planned."
                  : "Nothing to plan yet — add a task first."}
              </p>
            ) : (
              <ul className="space-y-3">
                {candidates.map((task) => (
                  <li
                    key={task.id}
                    className="flex items-center gap-3 rounded-2xl border border-stone-200 bg-white px-4 py-3"
                  >
                    <span className="flex-1 text-[0.95rem] leading-snug text-stone-800">
                      {task.title}
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      className={`${secondaryButton} px-4 py-2 text-xs`}
                      onClick={() =>
                        void run(() => addPriority({ data: { taskId: task.id } }))
                      }
                    >
                      Add
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {error ? <p className="text-sm text-red-700">{error}</p> : null}
      </div>
    </Shell>
  );
}
