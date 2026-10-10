import { useEffect, useState } from "react";
import {
  Link,
  createFileRoute,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import {
  askForHelp,
  chooseNext,
  endSprint,
  pageSprint,
  startSprint,
  type Outcome,
  type StuckPrompt,
} from "~/server/focus";
import { addSteps } from "~/server/tasks";
import { NotConnected, ScreenTitle, quietButton } from "~/components/Shell";

/**
 * The focus sprint — the heart of the product.
 *
 * While a sprint runs this screen shows the current step, the time left and
 * "I'm stuck". Nothing else: no list, no navigation, no numbers about the past.
 *
 * The countdown is derived from the sprint's `started_at` in the database, so a
 * reload (or a phone locking, or the tab being closed and reopened) shows the
 * real time left rather than restarting the clock.
 */

export const Route = createFileRoute("/focus/$sessionId")({
  loader: async ({ params }) => {
    const data = await pageSprint({ data: { sessionId: params.sessionId } });
    if (data.kind === "signed_out") throw redirect({ to: "/login" });
    return data;
  },
  component: SprintRoute,
});

function SprintRoute() {
  const data = Route.useLoaderData();
  if (data.kind === "not_connected") {
    return (
      <Minimal>
        <NotConnected reason={data.reason} />
      </Minimal>
    );
  }
  if (data.kind === "missing") {
    return (
      <Minimal>
        <div className="max-w-md space-y-4 text-center">
          <ScreenTitle>That sprint isn&rsquo;t here</ScreenTitle>
          <p className="text-sm text-stone-500">
            It may have been deleted, or it belongs to another account.
          </p>
          <Link to="/tasks" className={quietButton}>
            Back to your tasks
          </Link>
        </div>
      </Minimal>
    );
  }
  return (
    <Sprint
      sessionId={data.sessionId}
      taskId={data.taskId}
      plannedMinutes={data.plannedMinutes}
      startedAt={data.startedAt}
      endedAt={data.endedAt}
      savedOutcome={data.outcome}
      stepText={data.step?.text ?? null}
      nextStepText={data.nextStep?.text ?? null}
    />
  );
}

/** Full-height, centred, no header and no navigation chrome. */
function Minimal({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-stone-50">
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-10 px-6 py-10 text-center">
        {children}
      </main>
      <TrustFooter />
    </div>
  );
}

function TrustFooter({ children }: { children?: React.ReactNode }) {
  return (
    <footer className="mx-auto w-full max-w-md space-y-3 px-6 pb-8 text-center">
      {children}
      <p className="text-[0.7rem] leading-relaxed text-stone-400">
        FocusPilot is a productivity tool, not medical care.
      </p>
    </footer>
  );
}

function clock(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  return `${minutes}:${String(safe % 60).padStart(2, "0")}`;
}

function Sprint({
  sessionId,
  taskId,
  plannedMinutes,
  startedAt,
  endedAt,
  savedOutcome,
  stepText,
  nextStepText,
}: {
  sessionId: string;
  taskId: string;
  plannedMinutes: number;
  startedAt: string;
  endedAt: string | null;
  savedOutcome: Outcome | null;
  stepText: string | null;
  nextStepText: string | null;
}) {
  const navigate = useNavigate();
  const [now, setNow] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Looking back at the clock rather than counting from local state.
  const [stopped, setStopped] = useState(false);
  const [ended, setEnded] = useState(endedAt !== null);
  const [outcome, setOutcome] = useState<Outcome | null>(savedOutcome);
  const [prompt, setPrompt] = useState<StuckPrompt | null>(null);
  const [turn, setTurn] = useState(0);
  const [writing, setWriting] = useState(false);
  const [nextDraft, setNextDraft] = useState(nextStepText ?? "");
  // The loader's `nextStepText` is from before the sprint was closed, so it still
  // names the step that was just finished. Keep the step the server reported on
  // the way out and show that one.
  const [nextAfter, setNextAfter] = useState<string | null>(nextStepText ?? null);

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  const startMs = Date.parse(startedAt);
  const endMs = startMs + plannedMinutes * 60_000;
  const remaining =
    now === null
      ? plannedMinutes * 60
      : Math.max(0, Math.round((endMs - now) / 1000));
  const finished = remaining <= 0;
  const inLoop = ended || stopped || finished;

  async function gotStuck() {
    if (busy) return;
    setBusy(true);
    try {
      const next = await askForHelp({ data: { sessionId, turn } });
      setPrompt(next);
      setTurn((value) => value + 1);
    } catch {
      setPrompt({
        source: "fallback",
        text: "Take one thing out of this step and do only that.",
        note: "Not AI — no suggestion was available, so this is a plain prompt.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function close(outcomeChoice: Outcome) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await endSprint({
        data: { sessionId, outcome: outcomeChoice },
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOutcome(result.outcome);
      setEnded(true);
      setNextAfter(result.nextStep?.text ?? null);
      if (result.nextStep) setNextDraft(result.nextStep.text);
    } catch {
      setError("Couldn't save that. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function recordNext(next: "another" | "break" | "later") {
    try {
      await chooseNext({ data: { sessionId, nextAction: next } });
    } catch {
      // The choice is a nicety; never block the person on it.
    }
  }

  async function anotherSprint() {
    if (busy) return;
    setBusy(true);
    setError(null);
    void recordNext("another");
    try {
      const result = await startSprint({
        data: { taskId, minutes: plannedMinutes },
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      await navigate({
        to: "/focus/$sessionId",
        params: { sessionId: result.sessionId },
      });
    } catch {
      setError("Couldn't start that. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function takeBreak() {
    void recordNext("break");
    await navigate({ to: "/tasks" });
  }

  async function saveForLater() {
    if (busy) return;
    setBusy(true);
    const text = nextDraft.trim();
    void recordNext("later");
    try {
      if (text) {
        await addSteps({ data: { taskId, steps: [text], source: "manual" } });
      }
    } catch {
      // Either way the person lands back on the task.
    } finally {
      setBusy(false);
      await navigate({ to: "/tasks/$taskId", params: { taskId } });
    }
  }

  // A task whose steps were all removed under a running sprint.
  if (!stepText && !inLoop) {
    return (
      <Minimal>
        <div className="max-w-md space-y-4">
          <ScreenTitle>Nothing to work on here</ScreenTitle>
          <p className="text-sm text-stone-500">
            Every step on this task is done or gone. Break it down again for the
            next piece.
          </p>
          <Link to="/tasks/$taskId" params={{ taskId }} className={quietButton}>
            Back to the task
          </Link>
        </div>
      </Minimal>
    );
  }

  if (inLoop && outcome === null) {
    return (
      <Minimal>
        <div className="w-full space-y-8">
          <div className="space-y-3">
            <p className="text-xs tracking-wide text-stone-400 uppercase">
              {stopped ? "Sprint stopped" : "Time's up"}
            </p>
            <ScreenTitle>What happened?</ScreenTitle>
          </div>
          <div className="space-y-3">
            {(
              [
                ["done", "Done"],
                ["partly", "Partly"],
                ["stuck", "Got stuck"],
              ] as [Outcome, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                disabled={busy}
                onClick={() => void close(value)}
                className="w-full rounded-full border border-stone-300 bg-white px-6 py-4 text-base font-medium text-stone-800 transition-colors hover:border-stone-400 disabled:opacity-40"
              >
                {label}
              </button>
            ))}
          </div>
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
        </div>
      </Minimal>
    );
  }

  if (inLoop) {
    const stepStillOpen = outcome !== "done";
    return (
      <Minimal>
        <div className="w-full space-y-8">
          <div className="space-y-3">
            <p className="text-xs tracking-wide text-stone-400 uppercase">
              {outcome === "done"
                ? "Step done"
                : outcome === "partly"
                  ? "Partly"
                  : "Got stuck"}
            </p>
            <ScreenTitle>What next?</ScreenTitle>
            {stepStillOpen && stepText ? (
              <p className="text-sm leading-relaxed text-stone-500">
                The same step is waiting: {stepText}
              </p>
            ) : null}
            {outcome === "done" ? (
              <p className="text-sm leading-relaxed text-stone-500">
                {nextAfter
                  ? `Next up: ${nextAfter}`
                  : "That was the last step on this task."}
              </p>
            ) : null}
          </div>

          {writing ? (
            <div className="space-y-4 text-left">
              <label
                htmlFor="next-step"
                className="block text-sm text-stone-600"
              >
                One line for next time (optional)
              </label>
              <input
                id="next-step"
                type="text"
                value={nextDraft}
                maxLength={300}
                onChange={(event) => {
                  setNextDraft(event.target.value);
                }}
                className="w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-base text-stone-900 focus:border-indigo-500 focus:outline-none"
              />
              <div className="flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void saveForLater()}
                  className="inline-flex items-center justify-center rounded-full bg-stone-900 px-5 py-2.5 text-sm font-medium text-stone-50 disabled:opacity-40"
                >
                  Save and close
                </button>
                <button
                  type="button"
                  className={quietButton}
                  onClick={() => void saveForLater()}
                >
                  Skip
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => void anotherSprint()}
                className="w-full rounded-full border border-stone-300 bg-white px-6 py-4 text-base font-medium text-stone-800 transition-colors hover:border-stone-400 disabled:opacity-40"
              >
                Another {plannedMinutes} minutes
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void takeBreak()}
                className="w-full rounded-full border border-stone-300 bg-white px-6 py-4 text-base font-medium text-stone-800 transition-colors hover:border-stone-400 disabled:opacity-40"
              >
                Take a break
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setWriting(true);
                }}
                className="w-full rounded-full border border-stone-300 bg-white px-6 py-4 text-base font-medium text-stone-800 transition-colors hover:border-stone-400 disabled:opacity-40"
              >
                Save the next step for later
              </button>
            </div>
          )}

          {error ? <p className="text-sm text-red-700">{error}</p> : null}
        </div>
      </Minimal>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-stone-50">
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-10 px-6 py-12 text-center">
        <p className="text-[1.35rem] leading-snug font-medium text-stone-800">
          {stepText}
        </p>
        <time
          className="text-6xl font-light tabular-nums tracking-tight text-stone-900"
          dateTime={`PT${String(remaining)}S`}
        >
          {clock(remaining)}
        </time>
        <div className="w-full space-y-4">
          <button
            type="button"
            disabled={busy}
            onClick={() => void gotStuck()}
            className="w-full rounded-full border border-stone-300 bg-white px-6 py-4 text-base font-medium text-stone-800 transition-colors hover:border-stone-400 disabled:opacity-40"
          >
            I&rsquo;m stuck
          </button>
          {prompt ? (
            <div className="space-y-2 rounded-2xl border border-stone-200 bg-white px-4 py-4 text-left">
              <p className="text-[0.95rem] leading-relaxed text-stone-800">
                {prompt.text}
              </p>
              <p className="text-xs leading-relaxed text-stone-400">
                {prompt.note ??
                  "Written by AI from your task and step. Ignore it if it isn't useful."}
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void gotStuck()}
                className={`${quietButton} text-xs`}
              >
                One more
              </button>
            </div>
          ) : null}
        </div>
      </main>
      <TrustFooter>
        <button
          type="button"
          className={`${quietButton} text-xs`}
          onClick={() => {
            setStopped(true);
          }}
        >
          End early
        </button>
      </TrustFooter>
    </div>
  );
}
