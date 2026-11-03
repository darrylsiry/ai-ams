import { aiEnabled } from "@/lib/ai";
import { askAssistant, assistantConfigured, cleanHistory, MAX_QUESTION_CHARS, startQuestion, type Usage } from "@/lib/assistant";
import { db } from "@/lib/db";
import { todayISO } from "@/lib/format";
import { CROSS_SITE_REFUSED, sameOrigin } from "@/lib/http";
import { scrubText } from "@/lib/redact";
import { DEFAULTS, getSetting } from "@/lib/settings";
import { currentUser } from "@/lib/user";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_BODY = 200_000;
const HEARTBEAT_MS = 15_000;   // a long Claude call sends nothing, and a proxy would call the stream dead

/** Ask the assistant; the answer streams back as newline-delimited JSON events (lookups as they happen, then the answer). */
export async function POST(req: Request) {
  // Each question is up to a dozen Claude calls in the person's name: only this site's own page may ask.
  if (!sameOrigin(req.headers)) return Response.json({ error: CROSS_SITE_REFUSED }, { status: 403 });
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) return Response.json({ error: "Send JSON: { question, history }" }, { status: 415 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return Response.json({ error: "That conversation is too long. Start a new one." }, { status: 413 });
  let body: { question?: unknown; history?: unknown } | null;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY) return Response.json({ error: "That conversation is too long. Start a new one." }, { status: 413 });
    body = JSON.parse(raw);
  } catch { return Response.json({ error: "Send JSON: { question, history }" }, { status: 400 }); }
  const question = String(body?.question ?? "").trim().slice(0, MAX_QUESTION_CHARS);
  if (!question) return Response.json({ error: "Ask something" }, { status: 400 });
  const history = cleanHistory(body?.history);
  const user = await currentUser();
  const allowed = await getSetting("ai_assists", DEFAULTS.ai_assists);

  const encoder = new TextEncoder();
  let gone = false;   // the reader left (Stop, or the page closed): nothing more can be sent
  const left = new AbortController();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: unknown) => { if (!gone) { try { controller.enqueue(encoder.encode(JSON.stringify(e) + "\n")); } catch { gone = true; } } };
      if (!assistantConfigured() || !aiEnabled()) { send({ type: "error", message: "The AI Assistant needs an Anthropic API key on this server (ANTHROPIC_API_KEY)." }); controller.close(); return; }
      if (allowed.assistant === false) { send({ type: "error", message: "An administrator has turned the AI Assistant off in Admin > Settings." }); controller.close(); return; }
      const asked = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM assistant_log WHERE username = $1 AND asked_at > now() - interval '1 hour'", [user.username]).then((r) => r.rows[0].n).catch(() => 0);
      const slot = startQuestion(user.id, Date.now(), asked);
      if ("refused" in slot) { send({ type: "error", message: slot.refused }); controller.close(); return; }
      const t0 = Date.now();
      const heartbeat = setInterval(() => send({ type: "ping" }), HEARTBEAT_MS);
      const tools: string[] = [];
      let rounds = 0, usage: Usage = { input: 0, output: 0, cache_read: 0 }, outcome = "stopped";
      try {
        for await (const event of askAssistant(question, history, { user, today: todayISO() }, { signal: AbortSignal.any([req.signal, left.signal]) })) {
          if (event.type === "tool") tools.push(event.name);
          if (event.type === "answer") { rounds = event.steps; usage = event.usage; outcome = "answered"; }
          if (event.type === "error") { rounds = event.steps ?? 0; usage = event.usage ?? usage; outcome = event.message === "Stopped." ? "stopped" : "failed"; }
          send(event);
        }
      } catch (err) {
        console.error("assistant: question failed", err);
        outcome = "failed";
        send({ type: "error", message: "Something went wrong answering that. Try again." });
      } finally {
        clearInterval(heartbeat);
        slot.release();
        // What went to Anthropic, for the agency's own record. A logging problem must not cost the answer.
        await db.query("INSERT INTO assistant_log (user_id, username, question, tools, rounds, input_tokens, output_tokens, cached_tokens, ms, outcome) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
          [user.id, user.username, scrubText(question).slice(0, 500), tools, rounds, usage.input, usage.output, usage.cache_read, Date.now() - t0, outcome]).catch((err) => console.error("assistant: not logged", err));
        if (!gone) { try { controller.close(); } catch { /* the reader has gone */ } }
      }
    },
    cancel() { gone = true; left.abort(); },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
