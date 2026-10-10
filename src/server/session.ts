import { createHash, randomBytes } from "node:crypto";
import {
  deleteCookie,
  getCookie,
  getRequestHeader,
  getRequestProtocol,
  setCookie,
} from "@tanstack/react-start/server";
import { db } from "~/db";

/**
 * Session plumbing, server-side only. A session is an opaque random token kept
 * in an httpOnly cookie; the database only ever sees the token's SHA-256 hash.
 */

export const SESSION_COOKIE = "fp_session";
const SESSION_DAYS = 30;

export type SessionUser = { id: string; email: string };

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function isHttps(): boolean {
  try {
    if (getRequestProtocol() === "https") return true;
    const forwarded = getRequestHeader("x-forwarded-proto");
    return (
      typeof forwarded === "string" &&
      forwarded.split(",")[0]?.trim() === "https"
    );
  } catch {
    return false;
  }
}

export function startSessionCookie(token: string): void {
  setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    // Secure only when the visitor really is on https: the cookie must still
    // work over plain http on the local preview server.
    secure: isHttps(),
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export function clearSessionCookie(): void {
  deleteCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: isHttps(),
  });
}

export async function createSession(userId: string): Promise<void> {
  const sql = await db();
  const token = randomBytes(32).toString("base64url");
  await sql`
    insert into sessions (user_id, token_hash, expires_at)
    values (${userId}, ${hashToken(token)}, now() + ${`${SESSION_DAYS} days`}::interval)
  `;
  startSessionCookie(token);
}

export async function currentUser(): Promise<SessionUser | null> {
  const token = getCookie(SESSION_COOKIE);
  if (!token) return null;
  const sql = await db();
  const rows = await sql<{ id: string; email: string }[]>`
    select u.id, u.email
      from sessions s
      join users u on u.id = s.user_id
     where s.token_hash = ${hashToken(token)}
       and s.expires_at > now()
     limit 1
  `;
  const row = rows[0];
  return row ? { id: row.id, email: row.email } : null;
}

export async function endSession(): Promise<void> {
  const token = getCookie(SESSION_COOKIE);
  if (token) {
    try {
      const sql = await db();
      await sql`delete from sessions where token_hash = ${hashToken(token)}`;
    } catch (error) {
      console.error("[focuspilot] could not delete session row:", error);
    }
  }
  clearSessionCookie();
}

/** For a handler that must have someone signed in. */
export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) throw new Error("Please sign in again.");
  return user;
}
