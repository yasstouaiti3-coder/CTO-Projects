import { useState } from "react";
import { Link, createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import {
  addSteps,
  deleteStep,
  deleteTask,
  pageTask,
  renameTask,
  setStepDone,
  setTaskStatus,
  updateStep,
} from "~/server/tasks";
import type { StepRow } from "~/server/tasks";
import { breakItDown } from "~/server/ai";
import { SignOutButton } from "~/components/SignOutButton";
import {
  Hint,
  NotConnected,
  Shell,
  inputClass,
  primaryButton,
  quietButton,
  secondaryButton,
} from "~/components/Shell";

export const Route = createFileRoute("/tasks_/$taskId")({
  loader: async ({ params }) => {
    const data = await pageTask({ data: { taskId: params.taskId } });
    if (data.kind === "signed_out") throw redirect({ to: "/login" });
    return data;
  },
  component: TaskPage,
});

type Review = { source: "ai" | "fallback"; steps: string[]; note?: string };

function TaskPage() {
  const data = Route.useLoaderData();
  if (data.kind === "not_connected") {
    return <NotConnected reason={data.reason} />;
  }
  if (data.kind === "missing") {
    return (
      <Shell right={<SignOutButton />}>
        <div className="max-w-md space-y-4 pt-8">
          <h1 className="text-2xl font-semibold text-stone-900">
            That task isn&rsquo;t here
          </h1>
          <Hint>It may have been deleted.</Hint>
          <Link to="/tasks" className={quietButton}>
            Back to your tasks
          </Link>
        </div>
      </Shell>
    );
  }
  return (
    <TaskDetail
      taskId={data.task.id}
      title={data.task.title}
      status={data.task.status}
      steps={data.steps}
      sprint={data.task.sprint}
    />
  );
}

function TaskDetail({
  taskId,
  title,
  status,
  steps,
  sprint,
}: {
  taskId: string;
  title: string;
  status: "active" | "done" | "archived";
  steps: StepRow[];
  sprint: {
    sessionId: string;
    plannedMinutes: number;
    startedAt: string;
    /** Server truth: is the clock still ticking on this sprint? */
    running: boolean;
  } | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(title);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [draft, setDraft] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);

  async function saveTitle() {
    const next = titleDraft.trim();
    setEditingTitle(false);
    if (!next || next === title) {
      setTitleDraft(title);
      return;
    }
    setBusy(true);
    try {
      await renameTask({ data: { taskId, title: next } });
      await router.invalidate();
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(next: "active" | "done" | "archived") {
    setBusy(true);
    try {
      await setTaskStatus({ data: { taskId, status: next } });
      await router.invalidate();
    } finally {
      setBusy(false);
    }
  }

  async function breakDown() {
    setBusy(true);
    setNote(null);
    try {
      const result = await breakItDown({ data: { taskId } });
      if (result.steps.length === 0) {
        setNote(result.note ?? "Couldn't suggest steps just now. Try again.");
        setReview(null);
        return;
      }
      setReview(result);
      setDraft(result.steps);
    } catch {
      setNote("That didn't go through. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  async function acceptSteps() {
    if (!review) return;
    const keep = draft.map((step) => step.trim()).filter(Boolean);
    if (keep.length === 0) {
      setReview(null);
      return;
    }
    setBusy(true);
    try {
      await addSteps({ data: { taskId, steps: keep, source: review.source } });
      setReview(null);
      setDraft([]);
      await router.invalidate();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell right={<SignOutButton />}>
      <div className="space-y-8">
        <Link to="/tasks" className={quietButton}>
          ← All tasks
        </Link>

        <div className="space-y-3">
          {editingTitle ? (
            <div className="space-y-3">
              <input
                type="text"
                value={titleDraft}
                autoFocus
                maxLength={300}
                onChange={(event) => {
                  setTitleDraft(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void saveTitle();
                  if (event.key === "Escape") {
                    setTitleDraft(title);
                    setEditingTitle(false);
                  }
                }}
                className={inputClass}
              />
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  className={primaryButton}
                  disabled={busy}
                  onClick={() => void saveTitle()}
                >
                  Save
                </button>
                <button
                  type="button"
                  className={quietButton}
                  onClick={() => {
                    setTitleDraft(title);
                    setEditingTitle(false);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <h1 className="text-2xl leading-snug font-semibold text-stone-900">
                {title}
              </h1>
              <button
                type="button"
                className={quietButton}
                onClick={() => {
                  setTitleDraft(title);
                  setEditingTitle(true);
                }}
              >
                Edit title
              </button>
            </div>
          )}
        </div>

        <section className="space-y-4">
          {sprint ? (
            <div className="space-y-3 rounded-2xl border border-stone-200 bg-white px-5 py-5">
              {/* A sprint whose time has run out is not "still running": say what
                  is actually true and offer the one useful next move. */}
              {sprint.running ? (
                <>
                  <p className="text-sm leading-relaxed text-stone-700">
                    A sprint is running on this task. You have the time you have
                    left.
                  </p>
                  <Link
                    to="/focus/$sessionId"
                    params={{ sessionId: sprint.sessionId }}
                    className={`${primaryButton} no-underline`}
                  >
                    Return to sprint
                  </Link>
                </>
              ) : (
                <>
                  <p className="text-sm leading-relaxed text-stone-700">
                    Time ran out on your sprint. Nothing is counting down.
                  </p>
                  <Link
                    to="/focus/$sessionId"
                    params={{ sessionId: sprint.sessionId }}
                    className={`${primaryButton} no-underline`}
                  >
                    Wrap it up
                  </Link>
                  <p className="text-xs leading-relaxed text-stone-500">
                    One tap says what happened, and the sprint is closed.
                  </p>
                </>
              )}
            </div>
          ) : steps.some((step) => !step.done) ? (
            <div className="space-y-3">
              <Link
                to="/start/$taskId"
                params={{ taskId }}
                className={`${primaryButton} no-underline`}
              >
                Start a focus sprint
              </Link>
              <p className="text-sm leading-relaxed text-stone-500">
                Starting with: {steps.find((step) => !step.done)?.text}
              </p>
            </div>
          ) : null}

          <div className="flex items-baseline justify-between">
            <h2 className="text-xs font-medium tracking-wide text-stone-400 uppercase">
              Steps
            </h2>
            {steps.length > 0 ? (
              <button
                type="button"
                disabled={busy}
                className={quietButton}
                onClick={() => void breakDown()}
              >
                {busy ? "Thinking…" : "Break it down again"}
              </button>
            ) : null}
          </div>

          {steps.length === 0 ? (
            <div className="space-y-4 rounded-2xl border border-dashed border-stone-300 px-5 py-6">
              <p className="text-sm leading-relaxed text-stone-500">
                No steps yet. Breaking it down gives you a few small first
                moves — edit them, or throw them away.
              </p>
              <button
                type="button"
                className={primaryButton}
                disabled={busy}
                onClick={() => void breakDown()}
              >
                {busy ? "Thinking…" : "Break it down"}
              </button>
            </div>
          ) : (
            <ul className="space-y-2.5">
              {steps.map((step, index) => (
                <StepItem key={step.id} step={step} index={index} />
              ))}
            </ul>
          )}

          {note ? <p className="text-sm text-stone-500">{note}</p> : null}

          {review ? (
            <div className="space-y-4 rounded-2xl border border-stone-200 bg-white p-5">
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-stone-800">
                  {review.source === "ai"
                    ? "Suggested steps"
                    : "Starting steps"}
                </h3>
                {review.source === "fallback" ? (
                  <p className="rounded-xl bg-stone-100 px-3 py-2 text-xs leading-relaxed text-stone-600">
                    {review.note ??
                      "AI suggestions aren't available right now. These are plain starting steps."}
                  </p>
                ) : (
                  <p className="text-xs text-stone-500">
                    Written by AI from your task title. Change anything.
                  </p>
                )}
              </div>

              <ul className="space-y-2.5">
                {draft.map((step, index) => (
                  <li key={index} className="flex items-start gap-3">
                    <span className="mt-3 w-4 shrink-0 text-xs text-stone-400">
                      {index + 1}
                    </span>
                    <input
                      type="text"
                      value={step}
                      maxLength={300}
                      onChange={(event) => {
                        const next = [...draft];
                        next[index] = event.target.value;
                        setDraft(next);
                      }}
                      className={inputClass}
                    />
                    <button
                      type="button"
                      className={`${quietButton} mt-3 shrink-0`}
                      onClick={() => {
                        setDraft(draft.filter((_, i) => i !== index));
                      }}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>

              <div className="flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  className={primaryButton}
                  disabled={busy || draft.every((step) => !step.trim())}
                  onClick={() => void acceptSteps()}
                >
                  Add these steps
                </button>
                <button
                  type="button"
                  className={secondaryButton}
                  disabled={busy}
                  onClick={() => void breakDown()}
                >
                  Try again
                </button>
                <button
                  type="button"
                  className={quietButton}
                  disabled={busy}
                  onClick={() => {
                    setReview(null);
                    setDraft([]);
                  }}
                >
                  Discard
                </button>
              </div>
            </div>
          ) : null}
        </section>

        <section className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-stone-200 pt-6 text-xs text-stone-500">
          {status === "active" ? (
            <button
              type="button"
              disabled={busy}
              className={quietButton}
              onClick={() => void setStatus("done")}
            >
              Mark done
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              className={quietButton}
              onClick={() => void setStatus("active")}
            >
              Reopen
            </button>
          )}
          {status === "archived" ? (
            <button
              type="button"
              disabled={busy}
              className={quietButton}
              onClick={() => void setStatus("active")}
            >
              Unarchive
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              className={quietButton}
              onClick={() => void setStatus("archived")}
            >
              Archive
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            className={quietButton}
            onClick={() => {
              if (!confirmingDelete) {
                setConfirmingDelete(true);
                return;
              }
              void (async () => {
                setBusy(true);
                try {
                  await deleteTask({ data: { taskId } });
                  window.location.assign("/tasks");
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            {confirmingDelete ? "Tap again to delete" : "Delete"}
          </button>
        </section>
      </div>
    </Shell>
  );
}

function StepItem({ step, index }: { step: StepRow; index: number }) {
  const router = useRouter();
  const [text, setText] = useState(step.text);
  const [busy, setBusy] = useState(false);

  async function save() {
    const next = text.trim();
    if (next === step.text.trim()) return;
    setBusy(true);
    try {
      await updateStep({ data: { stepId: step.id, text: next } });
      await router.invalidate();
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex items-start gap-3 rounded-2xl border border-stone-200 bg-white px-4 py-2.5">
      <span className="mt-2.5 w-4 shrink-0 text-xs text-stone-400">
        {index + 1}
      </span>
      <input
        type="text"
        value={text}
        maxLength={300}
        // Saved on blur: no Save button to hunt for.
        onChange={(event) => {
          setText(event.target.value);
        }}
        onBlur={() => void save()}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        className={`min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-1 py-2 text-[0.95rem] focus:border-stone-300 focus:bg-white focus:outline-none ${
          step.done ? "text-stone-400 line-through" : "text-stone-800"
        }`}
      />
      <div className="mt-1.5 flex shrink-0 flex-col items-end gap-1 text-right">
        <button
          type="button"
          disabled={busy}
          className={`${quietButton} text-xs`}
          onClick={() => {
            void (async () => {
              setBusy(true);
              try {
                await setStepDone({
                  data: { stepId: step.id, done: !step.done },
                });
                await router.invalidate();
              } finally {
                setBusy(false);
              }
            })();
          }}
        >
          {step.done ? "Undo" : "Mark done"}
        </button>
        <button
          type="button"
          disabled={busy}
          className={`${quietButton} text-xs`}
          onClick={() => {
            void (async () => {
              setBusy(true);
              try {
                await deleteStep({ data: { stepId: step.id } });
                await router.invalidate();
              } finally {
                setBusy(false);
              }
            })();
          }}
        >
          Remove
        </button>
      </div>
    </li>
  );
}
