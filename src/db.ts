import postgres from "postgres";

/**
 * Server-only handle to the team's database (plain TCP Postgres).
 *
 * The connection string comes from `DATABASE_URL` — the owner connects the
 * database from the database card and the value is injected into the sandbox and
 * into the live site. It is read lazily (per call, never at module load) so the
 * site still builds and serves before a database is connected; a query without
 * `DATABASE_URL` throws a plain Error that callers turn into the calm
 * "not connected yet" screen rather than a stack trace.
 *
 * Use only inside `createServerFn()` handlers or `src/routes/api/*` routes.
 *
 *   const rows = await sql()`select id, title from tasks`;
 *
 * Postgres is reached over TCP (postgres.js), not the Neon HTTP driver: the
 * owner's card provides a standard connection string, and the pooler/direct
 * hostnames of managed providers are all reachable this way.
 */

export type DbStatus =
  | { ok: true }
  | { ok: false; reason: "missing" | "unreachable"; message: string };

let client: postgres.Sql | undefined;
let schemaPromise: Promise<void> | undefined;

/** Postgres error codes we branch on. */
export const UNIQUE_VIOLATION = "23505";

const SCHEMA_STATEMENTS = [
  `create table if not exists users (
     id uuid primary key default gen_random_uuid(),
     email text not null unique,
     password_hash text not null,
     created_at timestamptz not null default now()
   )`,
  `create table if not exists sessions (
     id uuid primary key default gen_random_uuid(),
     user_id uuid not null references users(id) on delete cascade,
     token_hash text not null unique,
     created_at timestamptz not null default now(),
     expires_at timestamptz not null
   )`,
  `create index if not exists sessions_user_id_idx on sessions (user_id)`,
  `create table if not exists tasks (
     id uuid primary key default gen_random_uuid(),
     user_id uuid not null references users(id) on delete cascade,
     title text not null,
     status text not null default 'active',
     created_at timestamptz not null default now(),
     updated_at timestamptz not null default now(),
     completed_at timestamptz,
     archived_at timestamptz
   )`,
  `create index if not exists tasks_user_status_idx on tasks (user_id, status, created_at desc)`,
  `create table if not exists steps (
     id uuid primary key default gen_random_uuid(),
     task_id uuid not null references tasks(id) on delete cascade,
     user_id uuid not null references users(id) on delete cascade,
     position integer not null default 0,
     text text not null,
     source text not null default 'manual',
     done boolean not null default false,
     created_at timestamptz not null default now(),
     updated_at timestamptz not null default now()
   )`,
  `create index if not exists steps_task_position_idx on steps (task_id, position)`,
  `create table if not exists focus_sessions (
     id uuid primary key default gen_random_uuid(),
     user_id uuid not null references users(id) on delete cascade,
     task_id uuid references tasks(id) on delete cascade,
     step_id uuid references steps(id) on delete set null,
     planned_minutes integer not null,
     started_at timestamptz not null default now(),
     ended_at timestamptz,
     completed boolean not null default false,
     note text
   )`,
  `create index if not exists focus_sessions_user_started_idx on focus_sessions (user_id, started_at desc)`,
  // Added with the focus sprint. Idempotent so an older database picks them up.
  // `outcome` is what the person said happened (done | partly | stuck) and
  // `next_action` is what they chose to do afterwards (another | break | later).
  `alter table focus_sessions add column if not exists outcome text`,
  `alter table focus_sessions add column if not exists next_action text`,
  // Finding the one sprint a person may have open at a time.
  `create index if not exists focus_sessions_open_idx on focus_sessions (user_id, task_id) where ended_at is null`,
  `create table if not exists daily_priorities (
     id uuid primary key default gen_random_uuid(),
     user_id uuid not null references users(id) on delete cascade,
     task_id uuid not null references tasks(id) on delete cascade,
     day date not null,
     position integer not null default 0,
     created_at timestamptz not null default now(),
     unique (user_id, day, position)
   )`,
  `create index if not exists daily_priorities_user_day_idx on daily_priorities (user_id, day)`,
  // One optional, user-controlled reminder per person. Off unless they turn it
  // on, and only ever surfaced inside the app (see src/server/reminder.ts).
  `create table if not exists reminder_settings (
     user_id uuid primary key references users(id) on delete cascade,
     enabled boolean not null default false,
     at_time text not null default '09:00',
     last_shown_on date,
     updated_at timestamptz not null default now()
   )`,
];

function sslOption(url: string): postgres.Options<never>["ssl"] {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "prefer";
  }
  const mode = parsed.searchParams.get("sslmode");
  if (mode === "disable") return false;
  if (mode === "no-verify") return { rejectUnauthorized: false };
  if (mode === "require") return { rejectUnauthorized: false };
  if (mode === "verify-full" || mode === "verify-ca") return true;
  if (/^(localhost|127\.0\.0\.1|::1|\[::1\])$/.test(parsed.hostname)) return false;
  // Everything else (a managed provider on the public internet) gets TLS when
  // the server offers it — 'prefer' also works against a local plain Postgres.
  return "prefer";
}

/** True when a connection string is present in the environment. */
export function isConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/**
 * Query parameters a hosted provider adds for *libpq* clients, which postgres.js
 * does not understand. postgres.js forwards every parameter it finds in the URL
 * into the startup packet, and a server or pooler that does not recognise one can
 * refuse the connection outright (Neon's strings carry `channel_binding`; Prisma
 * and others add `sslrootcert` and `options`). Nothing here is a value we need:
 * TLS is decided by `sslOption()` from `sslmode`, and the certificate lives in the
 * pooler, not on our disk. Removing just these three leaves every other parameter
 * — `sslmode` above all — exactly as the owner's string had it.
 */
const UNSUPPORTED_PARAMS = ["channel_binding", "sslrootcert", "options"];

/**
 * Strip the parameters above before postgres.js sees the URL. Returns the URL
 * untouched when there is nothing to strip (or it does not parse as a URL), so
 * the common case is byte-for-byte the owner's string.
 */
export function stripUnsupportedParams(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  let stripped = false;
  for (const name of UNSUPPORTED_PARAMS) {
    if (parsed.searchParams.has(name)) {
      parsed.searchParams.delete(name);
      stripped = true;
    }
  }
  return stripped ? parsed.toString() : url;
}

function connect(): postgres.Sql {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set — connect the database from the owner's database card before storing data."
    );
  }
  client ??= postgres(stripUnsupportedParams(url), {
    max: 4,
    idle_timeout: 20,
    connect_timeout: 12,
    // Managed poolers (Neon/Supavisor, Tiger Cloud) run in transaction mode and
    // reject session-level prepared statements; unnamed statements always work.
    prepare: false,
    // Read from the original string: stripping the parameters above must not
    // change how `sslmode` is interpreted.
    ssl: sslOption(url),
    onnotice: () => {},
  });
  return client;
}

async function runSchema(sql: postgres.Sql): Promise<void> {
  for (const statement of SCHEMA_STATEMENTS) {
    await sql.unsafe(statement);
  }
}

/**
 * Tagged-template handle to the database. Throws if no connection string is
 * configured; callers wrap that into `DbStatus`.
 */
export function sql(): postgres.Sql {
  return connect();
}

/**
 * Same as `sql()`, but the schema is created first (idempotently, once per
 * process). Every server function that touches a table goes through this.
 */
export async function db(): Promise<postgres.Sql> {
  const handle = connect();
  schemaPromise ??= runSchema(handle).catch((error: unknown) => {
    // Let the next call retry instead of caching a broken schema forever.
    schemaPromise = undefined;
    throw error;
  });
  await schemaPromise;
  return handle;
}

let cached: { at: number; status: DbStatus } | undefined;

/** Cached health probe used to render the "not connected yet" screens. */
export async function dbStatus(): Promise<DbStatus> {
  if (!isConfigured()) {
    return {
      ok: false,
      reason: "missing",
      message: "No database is connected yet.",
    };
  }
  const fresh = cached?.status.ok ? 20_000 : 3_000;
  if (cached && Date.now() - cached.at < fresh) return cached.status;

  let status: DbStatus;
  try {
    const handle = await db();
    await withTimeout(
      handle`select 1 as ok`,
      8_000,
      "Database connection timed out."
    );
    status = { ok: true };
  } catch (error) {
    console.error("[focuspilot] database unreachable:", error);
    status = {
      ok: false,
      reason: "unreachable",
      message: "The database could not be reached just now.",
    };
  }
  cached = { at: Date.now(), status };
  return status;
}

export async function withTimeout<T>(
  work: PromiseLike<T>,
  ms: number,
  message: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Timestamps arrive as JS Dates; React cannot render them. */
export function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value ?? "");
}
