import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

/**
 * The app shell: one narrow column, generous whitespace, one accent colour
 * (indigo) over a muted stone palette. No dashboards, no streaks, no badges.
 */

export const primaryButton =
  "inline-flex items-center justify-center rounded-full bg-stone-900 px-5 py-2.5 text-sm font-medium text-stone-50 transition-colors hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-40";

export const secondaryButton =
  "inline-flex items-center justify-center rounded-full border border-stone-300 bg-white px-5 py-2.5 text-sm font-medium text-stone-700 transition-colors hover:border-stone-400 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-40";

export const quietButton =
  "inline-flex min-h-[44px] items-center text-sm text-stone-500 underline decoration-stone-300 underline-offset-4 transition-colors hover:text-stone-800 disabled:opacity-40";

export const inputClass =
  "w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-base text-stone-900 placeholder:text-stone-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100";

export const card = "rounded-2xl border border-stone-200 bg-white p-5";

export function Wordmark({ href = "/" }: { href?: string }) {
  return (
    <Link
      to={href}
      className="text-sm font-semibold tracking-wide text-stone-900 no-underline"
    >
      FocusPilot
    </Link>
  );
}

export function TrustLine() {
  return (
    <p className="mx-auto max-w-xl px-6 pb-10 text-xs leading-relaxed text-stone-400">
      FocusPilot is a productivity tool, not medical care.
    </p>
  );
}

export function Shell({
  children,
  right,
}: {
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-stone-50">
      <header className="mx-auto flex w-full max-w-xl items-center justify-between px-6 pt-8 pb-2">
        <Wordmark />
        <div className="flex items-center gap-4 text-sm text-stone-500">
          {right}
        </div>
      </header>
      <main className="mx-auto w-full max-w-xl flex-1 px-6 pt-6 pb-16">
        {children}
      </main>
      <TrustLine />
    </div>
  );
}

export function ScreenTitle({ children }: { children: ReactNode }) {
  return (
    <h1 className="text-2xl leading-snug font-semibold text-stone-900">
      {children}
    </h1>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-relaxed text-stone-500">{children}</p>;
}

/**
 * Calm screen shown while the app has no working data store behind it. It is a
 * public screen, so the wording stays plain: how FocusPilot is run and the
 * technical reason stay in the server payload and the server logs, never here.
 */
export function NotConnected({
  reason,
}: {
  reason?: "missing" | "unreachable";
}) {
  const line =
    reason === "unreachable"
      ? "FocusPilot can\u2019t reach your account right now. Try again in a moment."
      : "FocusPilot is still being set up. Try again shortly.";
  return (
    <Shell>
      <div className="max-w-md space-y-4 pt-6">
        <ScreenTitle>FocusPilot isn&rsquo;t ready yet</ScreenTitle>
        <Hint>
          Nothing here is lost, and there is nothing for you to do. Come back a
          little later.
        </Hint>
        <p className="rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-600">
          {line}
        </p>
      </div>
    </Shell>
  );
}
