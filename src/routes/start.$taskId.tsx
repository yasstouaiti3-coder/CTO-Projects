import { useState } from "react";
import { Link, createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { pageTask } from "~/server/tasks";
import { DURATIONS, startSprint } from "~/server/focus";
import { SignOutButton } from "~/components/SignOutButton";
import {
  Hint,
  NotConnected,
  Shell,
  ScreenTitle,
  quietButton,
  secondaryButton,
} from "~/components/Shell";

/**
 * One choice per screen: how long? Nothing else is on this page — no settings,
 * no duration memory, no options. Picking a length starts the sprint.
 */

export const Route = createFileRoute("/start/$taskId")({
  loader: async ({ params }) => {
    const data = await pageTask({ data: { taskId: params.taskId } });
    if (data.kind === "signed_out") throw redirect({ to: "/login" });
    return data;
  },
  component: ChooseDuration,
});

function ChooseDuration() {
  const data = Route.useLoaderData();
  if (data.kind === "not_connected") {
    return <NotConnected reason={data.reason} />;
  }
  if (data.kind === "missing") {
    return (
      <Shell right={<SignOutButton />}>
        <div className="max-w-md space-y-4 pt-8">
          <ScreenTitle>That task isn&rsquo;t here</ScreenTitle>
          <Link to="/tasks" className={quietButton}>
            Back to your tasks
          </Link>
        </div>
      </Shell>
    );
  }
  return (
    <Duration
      taskId={data.task.id}
      taskTitle={data.task.title}
      stepText={data.steps.find((step) => !step.done)?.text ?? null}
    />
  );
}

function Duration({
  taskId,
  taskTitle,
  stepText,
}: {
  taskId: string;
  taskTitle: string;
  stepText: string | null;
}) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(minutes: number) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await startSprint({ data: { taskId, minutes } });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      await navigate({
        to: "/focus/$sessionId",
        params: { sessionId: result.sessionId },
      });
    } catch {
      setError("That didn't go through. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell right={<SignOutButton />}>
      <div className="space-y-10">
        <Link to="/tasks/$taskId" params={{ taskId }} className={quietButton}>
          ← Back to the task
        </Link>

        <div className="space-y-4">
          <ScreenTitle>How long do you want to work?</ScreenTitle>
          <Hint>
            One step, one timer. Only that step stays on screen, and you can stop
            early whenever you need to.
          </Hint>
        </div>

        <div className="space-y-3">
          {DURATIONS.map((minutes) => (
            <button
              key={minutes}
              type="button"
              disabled={busy || !stepText}
              onClick={() => void choose(minutes)}
              className={`${secondaryButton} w-full py-5 text-base`}
            >
              {minutes} minutes
            </button>
          ))}
        </div>

        {stepText ? (
          <div className="space-y-2">
            <p className="text-xs tracking-wide text-stone-400 uppercase">
              Starting with
            </p>
            <p className="text-[0.95rem] leading-snug text-stone-700">
              {stepText}
            </p>
          </div>
        ) : (
          <Hint>
            This task has no open steps left. Break it down on the task page
            first.
          </Hint>
        )}

        {error ? <p className="text-sm text-red-700">{error}</p> : null}

        <p className="text-xs text-stone-400">{taskTitle}</p>
      </div>
    </Shell>
  );
}
