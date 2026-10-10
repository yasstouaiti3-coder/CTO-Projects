import { createServerFn } from "@tanstack/react-start";
import { db } from "~/db";
import { requireUser } from "~/server/session";

/**
 * The two places FocusPilot talks to a model, both server-side only:
 *
 * 1. "Break it down" — a few small first steps for one task title.
 * 2. "I'm stuck" — ONE short prompt that points at the next physical action.
 *
 * Neither ever sees more than the task title and the current step, and both
 * fall back to clearly-labelled, non-AI text when `OPENAI_API_KEY` is missing,
 * slow or unhappy. Fallback text is never presented as AI.
 */

export type Breakdown = {
  source: "ai" | "fallback";
  steps: string[];
  note?: string;
};

const SYSTEM_PROMPT = [
  "You help an adult who feels stuck turn one task into the first small steps.",
  'Reply with JSON only, in this shape: {"steps": ["...", "..."]}',
  "Rules: 2 to 5 steps; each step is one concrete action under 12 words;",
  "each step can be started in the next minute without deciding anything else;",
  "imperative voice, no encouragement, no advice, no diagnosis,",
  "no medical or therapeutic language, no numbering inside the text.",
].join(" ");

export const PROMPT_SYSTEM = [
  "You help an adult who is stuck in the middle of one step of a task.",
  'Reply with JSON only, in this shape: {"prompt": "..."}',
  "The prompt is ONE sentence under 18 words: either a single concrete question",
  "or one imperative telling them the very next physical action, or asking for",
  "the smallest version of what they are doing (the two-minute version, the",
  "first line, the one thing that is missing).",
  "No praise, no encouragement, no lists, no numbering, no emotional or",
  "therapeutic language, no diagnosis, no advice about how they feel,",
  "no medical or clinical words.",
].join(" ");

const MODELS = ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4o"];
/** Whole-call budget; the handler stays comfortably inside a ~10s request. */
const TOTAL_BUDGET_MS = 8_500;
const ATTEMPT_MS = 6_000;

export const breakItDown = createServerFn({ method: "POST" })
  .validator((data: { taskId: string }) => data)
  .handler(async ({ data }): Promise<Breakdown> => {
    const user = await requireUser();
    const sql = await db();
    const id =
      typeof data.taskId === "string" &&
      /^[0-9a-f-]{36}$/i.test(data.taskId.trim())
        ? data.taskId.trim()
        : "00000000-0000-0000-0000-000000000000";
    const rows = await sql<{ title: string }[]>`
      select title from tasks where id = ${id}::uuid and user_id = ${user.id} limit 1
    `;
    const title = rows[0]?.title ?? "";
    if (!title) {
      return {
        source: "fallback",
        steps: [],
        note: "That task is no longer here.",
      };
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return {
        source: "fallback",
        steps: fallbackSteps(title),
        note: "AI suggestions aren't available yet (no API key connected). These are plain starting steps, not AI.",
      };
    }

    const deadline = Date.now() + TOTAL_BUDGET_MS;
    const models = [process.env.OPENAI_MODEL, ...MODELS].filter(
      (model): model is string => Boolean(model)
    );

    for (const model of models) {
      if (Date.now() > deadline) break;
      try {
        const steps = await askModel(apiKey, model, title, deadline);
        if (steps.length >= 2) return { source: "ai", steps };
      } catch (error) {
        console.error(`[focuspilot] breakdown via ${model} failed:`, error);
      }
    }

    return {
      source: "fallback",
      steps: fallbackSteps(title),
      note: "AI suggestions aren't available right now, so these are plain starting steps, not AI. Edit or rewrite them freely.",
    };
  });

/**
 * "I'm stuck" — ONE short prompt for the step the person is on. Returns `null`
 * when there is no key or no usable reply; the caller then shows a rotating
 * prompt from a plain, non-AI list and says so on screen.
 */
export async function oneStuckPrompt(
  taskTitle: string,
  stepText: string
): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  const models = [process.env.OPENAI_MODEL, ...MODELS].filter(
    (model): model is string => Boolean(model)
  );
  for (const model of models) {
    if (Date.now() > deadline) break;
    try {
      const raw = await callChat(
        apiKey,
        model,
        PROMPT_SYSTEM,
        `Task: ${taskTitle}\nStep: ${stepText}`,
        deadline,
        90
      );
      const prompt = parsePrompt(raw);
      if (prompt) return prompt;
    } catch (error) {
      console.error(`[focuspilot] stuck prompt via ${model} failed:`, error);
    }
  }
  return null;
}

async function askModel(
  apiKey: string,
  model: string,
  title: string,
  deadline: number
): Promise<string[]> {
  return parseSteps(
    await callChat(apiKey, model, SYSTEM_PROMPT, title, deadline, 300)
  );
}

/** One JSON chat completion, with a hard per-attempt time budget. */
async function callChat(
  apiKey: string,
  model: string,
  system: string,
  user: string,
  deadline: number,
  maxTokens: number
): Promise<string> {
  const budget = Math.min(ATTEMPT_MS, deadline - Date.now());
  if (budget <= 500) throw new Error("out of time");

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, budget);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`${response.status} ${detail.slice(0, 200)}`);
    }
    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return payload.choices?.[0]?.message?.content ?? "";
  } finally {
    clearTimeout(timer);
  }
}

function parseSteps(content: string): string[] {
  const cleaned = content
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return [];
  }
  const raw = (parsed as { steps?: unknown }).steps;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((step) =>
      typeof step === "string" ? step.replace(/^\s*\d+[.)]\s*/, "").trim() : ""
    )
    .filter((step) => step.length > 0 && step.length <= 200)
    .slice(0, 5);
}

/** Words a productivity tool has no business using. */
const BANNED = [
  "diagnos",
  "therap",
  "depress",
  "anxiet",
  "medic",
  "disorder",
  "adhd",
  "symptom",
  "treat",
  "mental health",
  "you should see",
];

/** One plain sentence, or nothing at all. */
function parsePrompt(content: string): string | null {
  const cleaned = content
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/, "")
    .trim();
  let candidate = "";
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(cleaned.slice(start, end + 1)) as {
        prompt?: unknown;
      };
      if (typeof parsed.prompt === "string") candidate = parsed.prompt;
    } catch {
      candidate = "";
    }
  }
  if (!candidate) candidate = cleaned.split("\n")[0] ?? "";
  const text = candidate
    .replace(/^["'\s]+|["'\s]+$/g, "")
    .replace(/^\d+[.)]\s*/, "")
    .trim();
  if (text.length < 10 || text.length > 220) return null;
  const lower = text.toLowerCase();
  if (BANNED.some((word) => lower.includes(word))) return null;
  return text;
}

/** Plain, honest, generic first steps — no AI involved. */
function fallbackSteps(title: string): string[] {
  const short = title.length > 60 ? `${title.slice(0, 57)}…` : title;
  return [
    `Open everything you need for "${short}".`,
    "Write one rough line describing what done looks like.",
    "Spend five minutes on the smallest visible piece.",
  ];
}
