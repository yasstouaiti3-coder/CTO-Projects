import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { pageAuth } from "~/server/auth";
import {
  Hint,
  NotConnected,
  Shell,
  primaryButton,
  quietButton,
} from "~/components/Shell";

export const Route = createFileRoute("/")({
  loader: async () => {
    const data = await pageAuth();
    // Signed in already: nothing to market, go straight to the inbox.
    if (data.kind === "signed_in") throw redirect({ to: "/tasks" });
    return data;
  },
  component: Landing,
});

function Landing() {
  const data = Route.useLoaderData();
  if (data.kind === "not_connected") {
    return <NotConnected reason={data.reason} />;
  }

  return (
    <Shell>
      <div className="max-w-md space-y-8 pt-10">
        <div className="space-y-4">
          <h1 className="text-3xl leading-snug font-semibold text-stone-900">
            When you feel stuck, open FocusPilot and know what to do next.
          </h1>
          <Hint>
            Capture the thing you keep avoiding. Get a few small steps. Start
            one.
          </Hint>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <Link to="/signup" className={`${primaryButton} no-underline`}>
            Get started
          </Link>
          <Link to="/login" className={quietButton}>
            I already have an account
          </Link>
        </div>

        <div className="space-y-2 border-t border-stone-200 pt-6">
          <p className="text-base font-medium text-stone-800">
            One task at a time
          </p>
          <Hint>
            No dashboards, no streaks, no nudging. Your tasks are yours, and you
            can delete anything at any time.
          </Hint>
        </div>
      </div>
    </Shell>
  );
}
