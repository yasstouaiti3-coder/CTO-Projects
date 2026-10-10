import { createServerFn } from "@tanstack/react-start";
import { UNIQUE_VIOLATION, db, dbStatus, isConfigured } from "~/db";
import {
  clearSessionCookie,
  createSession,
  currentUser,
  endSession,
  type SessionUser,
} from "~/server/session";

/**
 * Auth server functions. Email + password only: no password reset, no OAuth, no
 * email verification in v1. Every handler that returns data checks the session
 * cookie first, and every query is scoped to the signed-in user.
 */

export type NotConnected = {
  kind: "not_connected";
  reason: "missing" | "unreachable";
  message: string;
};

export type PageAuth =
  | NotConnected
  | { kind: "signed_in"; user: SessionUser }
  | { kind: "signed_out" };

export type AuthResult =
  | { ok: true; user: SessionUser }
  | { ok: false; error: string };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function validate(email: string, password: string): string | null {
  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    return "That doesn't look like an email address.";
  }
  if (password.length < 8) {
    return "Use at least 8 characters for your password.";
  }
  if (password.length > 200) {
    return "That password is too long.";
  }
  return null;
}

async function notConnected(): Promise<NotConnected | null> {
  const status = await dbStatus();
  if (status.ok) return null;
  return { kind: "not_connected", reason: status.reason, message: status.message };
}

/** Used by page loaders to decide: show the form, or redirect into the app. */
export const pageAuth = createServerFn({ method: "POST" }).handler(
  async (): Promise<PageAuth> => {
    const offline = await notConnected();
    if (offline) return offline;
    const user = await currentUser();
    return user ? { kind: "signed_in", user } : { kind: "signed_out" };
  }
);

export const signUp = createServerFn({ method: "POST" })
  .validator((data: { email: string; password: string }) => data)
  .handler(async ({ data }): Promise<AuthResult> => {
    const email = normalizeEmail(data.email);
    const password = typeof data.password === "string" ? data.password : "";
    const problem = validate(email, password);
    if (problem) return { ok: false, error: problem };
    if (!isConfigured()) {
      return { ok: false, error: "Sign-up isn't available yet. Please try later." };
    }

    try {
      const sql = await db();
      // Bun's built-in hasher (argon2id) — no bcrypt dependency.
      const passwordHash = await Bun.password.hash(password, {
        algorithm: "argon2id",
        memoryCost: 19456,
        timeCost: 2,
      });
      const rows = await sql<{ id: string; email: string }[]>`
        insert into users (email, password_hash)
        values (${email}, ${passwordHash})
        returning id, email
      `;
      const user = rows[0];
      if (!user) return { ok: false, error: "Something went wrong. Please try again." };
      await createSession(user.id);
      return { ok: true, user: { id: user.id, email: user.email } };
    } catch (error) {
      if (isUniqueViolation(error)) {
        return {
          ok: false,
          error: "That email already has an account. Try signing in instead.",
        };
      }
      console.error("[focuspilot] sign-up failed:", error);
      return { ok: false, error: "Something went wrong. Please try again." };
    }
  });

export const logIn = createServerFn({ method: "POST" })
  .validator((data: { email: string; password: string }) => data)
  .handler(async ({ data }): Promise<AuthResult> => {
    const email = normalizeEmail(data.email);
    const password = typeof data.password === "string" ? data.password : "";
    if (!email || !password) {
      return { ok: false, error: "Enter your email and password." };
    }
    if (!isConfigured()) {
      return { ok: false, error: "Sign-in isn't available yet. Please try later." };
    }

    try {
      const sql = await db();
      const rows = await sql<{ id: string; email: string; password_hash: string }[]>`
        select id, email, password_hash from users where email = ${email} limit 1
      `;
      const row = rows[0];
      const matches = row
        ? await Bun.password.verify(password, row.password_hash)
        : false;
      if (!row || !matches) {
        return { ok: false, error: "That email and password don't match." };
      }
      await createSession(row.id);
      return { ok: true, user: { id: row.id, email: row.email } };
    } catch (error) {
      console.error("[focuspilot] sign-in failed:", error);
      return { ok: false, error: "Something went wrong. Please try again." };
    }
  });

export const logOut = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ ok: true }> => {
    try {
      await endSession();
    } catch (error) {
      console.error("[focuspilot] sign-out failed:", error);
      // The cookie still has to go, even if the database is unreachable.
      clearSessionCookie();
    }
    return { ok: true };
  }
);

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === UNIQUE_VIOLATION
  );
}
