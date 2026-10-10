import { useState } from "react";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { pageAuth, signUp } from "~/server/auth";
import {
  Hint,
  NotConnected,
  Shell,
  inputClass,
  primaryButton,
  quietButton,
} from "~/components/Shell";

export const Route = createFileRoute("/signup")({
  loader: async () => {
    const data = await pageAuth();
    if (data.kind === "signed_in") throw redirect({ to: "/tasks" });
    return data;
  },
  component: SignUpPage,
});

function SignUpPage() {
  const data = Route.useLoaderData();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (data.kind === "not_connected") {
    return <NotConnected reason={data.reason} />;
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await signUp({ data: { email, password } });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Full load, so the new session cookie is what the next request sends.
      window.location.assign("/tasks");
    } catch {
      setError("That didn't go through. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <div className="max-w-sm space-y-6 pt-8">
        <div className="space-y-3">
          <h1 className="text-2xl font-semibold text-stone-900">
            Create your account
          </h1>
          <Hint>Email and a password. That&rsquo;s all.</Hint>
        </div>

        <form onSubmit={submit} method="post" action="/signup" className="space-y-4">
          <label className="block space-y-2">
            <span className="text-sm text-stone-600">Email</span>
            <input
              type="email"
              name="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
              }}
              className={inputClass}
            />
          </label>
          <label className="block space-y-2">
            <span className="text-sm text-stone-600">Password</span>
            <input
              type="password"
              name="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
              }}
              className={inputClass}
            />
            <span className="block text-xs text-stone-400">
              At least 8 characters.
            </span>
          </label>

          {error ? <p className="text-sm text-red-700">{error}</p> : null}

          <button type="submit" disabled={busy} className={primaryButton}>
            {busy ? "Creating…" : "Create account"}
          </button>
        </form>

        <Link to="/login" className={quietButton}>
          I already have an account
        </Link>
      </div>
    </Shell>
  );
}
