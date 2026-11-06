import { shouldAvoidAi } from "./logic.js";

// Last five non-sensitive user/assistant turns, expiring one hour after the last turn.
// Never put chat history into R2 (it is only for canonical product facts).
const TTL_SECONDS = 3600;
const MAX_TURNS = 5;

export function redactForContext(text) {
  const raw = String(text || "").slice(0, 650);
  if (shouldAvoidAi(raw)) return ""; // Reject conversations that might contain secrets.
  return raw
    .replace(/https?:\/\/\S+/giu, "[link]")
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/giu, "[email]")
    .replace(/@[A-Za-z0-9_]{3,32}\b/gu, "[username]")
    .replace(/(?:\+?\d[\d\s().-]{7,}\d)/gu, "[number]")
    .replace(/\b\d{4,}\b/gu, "[number]")
    .replace(/\b[A-Za-z0-9_-]{28,}\b/gu, "[token]")
    .trim().slice(0, 350);
}

export async function readConversation(env, userId, now = Math.floor(Date.now() / 1000)) {
  if (!env.DB) return [];
  try {
    const row = await env.DB.prepare(
      "SELECT turns_json,updated_at FROM support_context WHERE tg_id=?"
    ).bind(userId).first();
    if (!row || Number(row.updated_at) < now - TTL_SECONDS) return [];
    const data = JSON.parse(row.turns_json || "[]");
    if (!Array.isArray(data)) return [];
    return data.slice(-MAX_TURNS).filter((x) =>
      x && (x.role === "user" || x.role === "assistant") &&
      typeof x.content === "string" && x.content.length > 0 && x.content.length <= 350
    );
  } catch {
    console.warn("support_context_read_failed");
    return []; // Context is optional, never interrupt support.
  }
}

export async function storeConversation(env, userId, history, question, answer, now = Math.floor(Date.now() / 1000)) {
  if (!env.DB) return;
  const user = redactForContext(question);
  const assistant = redactForContext(answer);
  if (!user || !assistant) return;
  const turns = [...history, { role: "user", content: user }, { role: "assistant", content: assistant }].slice(-MAX_TURNS);
  try {
    await env.DB.prepare(
      "INSERT INTO support_context(tg_id,turns_json,updated_at) VALUES(?,?,?) " +
      "ON CONFLICT(tg_id) DO UPDATE SET turns_json=excluded.turns_json,updated_at=excluded.updated_at"
    ).bind(userId, JSON.stringify(turns), now).run();
  } catch {
    console.warn("support_context_write_failed");
  }
}
