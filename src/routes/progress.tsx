import { Link, createFileRoute, redirect } from "@tanstack/react-router";
import { pageProgress } from "~/server/progress";
import { SignOutButton } from "~/components/SignOutButton";
import {
  Hint,
  NotConnected,
  Shell,
  ScreenTitle,
  quietButton,
} from "~/components/Shell";

export const Route = createFileRoute("/progress")({
  loader: async () => {
    const data = await pageProgress();
    if (data.kind === "signed_out") throw redirect({ to: "/login" });
    return data;
  },
  component: ProgressPage,
});

function ProgressPage() {
  const data = Route.useLoaderData();
  if (data.kind === "not_connected") {
    return <NotConnected reason={data.reason} />;
  }
  return <Progress started={data.started} finished={data.finished} />;
}

function Progress({ started, finished }: { started: number; finished: number }) {
  return (
    <Shell right={<SignOutButton />}>
      <div className="space-y-9">
        <Link to="/tasks" className={quietButton}>
          &larr; Your tasks
        </Link>

        <div className="space-y-3">
          <ScreenTitle>Progress</ScreenTitle>
          <Hint>Just so you know it&rsquo;s working. Nothing to keep up.</Hint>
        </div>

        <dl className="space-y-3 rounded-2xl border border-stone-200 bg-white px-5 py-5">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-[0.95rem] text-stone-700">Sprints started</dt>
            <dd className="text-[0.95rem] text-stone-900 tabular-nums">
              {started}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-[0.95rem] text-stone-700">Sprints finished</dt>
            <dd className="text-[0.95rem] text-stone-900 tabular-nums">
              {finished}
            </dd>
          </div>
        </dl>

        <p className="text-sm leading-relaxed text-stone-500">
          A sprint counts as finished once you tell us what happened — done,
          partly or stuck. All three end the same way here, and none of them
          shows up anywhere else. One that runs out of time before you say
          anything stays counted as started only.
        </p>
      </div>
    </Shell>
  );
}
