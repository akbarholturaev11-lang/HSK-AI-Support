import { shouldAvoidAi } from "./logic.js";

export const CONTEXT_TTL_SECONDS = 3600;
export const CONTEXT_MESSAGES = 5;

export function sanitizeConversationText(value) {
  const text = String(value || "").trim();
  if (!text || shouldAvoidAi(text)) return null;
  if (/\b(?:\d[ -]*?){9,}\b/u.test(text)) return null;
  const sanitized = text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/gu, "[email]")
    .replace(/\bhttps?:\/\/\S+/giu, "[link]")
    .replace(/\b\d{4,}\b/gu, "[number]")
    .slice(0, 350);
  return sanitized.trim() || null;
}

export async function loadRecentConversation(env, userId, now = Math.floor(Date.now()/1000)) {
  if (!env.DB) return [];
  try {
    const rs = await env.DB.prepare(
      "SELECT role,text FROM ai_conversation WHERE tg_id=? AND created_at >= ? ORDER BY id DESC LIMIT 5"
    ).bind(userId, now - CONTEXT_TTL_SECONDS).all();
    return (rs.results || []).filter(x =>
      (x.role === "user" || x.role === "assistant") && typeof x.text === "string"
    ).reverse().map(x => ({ role: x.role, content: x.text.slice(0,350) }));
  } catch {
    // Schema is rolled out separately. A missing context table must not break Support.
    return [];
  }
}

export async function saveConversationExchange(env, userId, question, answer, now = Math.floor(Date.now()/1000)) {
  if (!env.DB) return false;
  const q = sanitizeConversationText(question);
  const a = sanitizeConversationText(answer);
  if (!q || !a) return false;
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO ai_conversation(tg_id,role,text,created_at) VALUES(?,?,?,?)")
        .bind(userId,"user",q,now),
      env.DB.prepare("INSERT INTO ai_conversation(tg_id,role,text,created_at) VALUES(?,?,?,?)")
        .bind(userId,"assistant",a,now)
    ]);
    return true;
  } catch {
    return false;
  }
}
