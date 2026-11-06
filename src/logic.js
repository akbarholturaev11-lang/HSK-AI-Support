export function parseStartCommand(text) {
  const m = /^\/start(?:@[A-Za-z0-9_]+)?(?:\s+([A-Za-z0-9_-]{1,64}))?\s*$/.exec(String(text || "").trim());
  return m ? (m[1] || "") : null;
}

export function parseStartPayload(value) {
  const m = /^(ru|tj|uz)_(android|pwa|bot|web|ig|miniapp|desktop)$/.exec(String(value || "").toLowerCase());
  return m ? { lang: m[1], source: m[2] } : null;
}

export function telegramLanguage(value) {
  const code = String(value || "").toLowerCase().split("-")[0];
  if (code === "tg") return "tj";
  if (code === "uz") return "uz";
  return "ru";
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function limitText(value, length = 1200) {
  return String(value ?? "").trim().slice(0, length);
}

export function dayKey(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

export function isClose(text) {
  return /^\/close(?:@[A-Za-z0-9_]+)?\s*$/i.test(String(text || "").trim());
}

export function shouldAvoidAi(text) {
  return /(?:\b(?:cvv|cvc|password|otp|pin|sms.?code)\b|парол|код подтвержден|код тасди|рамзи|пароли|номер карты|рақами корт|карта рақами|(?:\d[\s-]?){12,19})/i.test(String(text || ""));
}

export function parseAiDecision(content) {
  let raw = String(content || "").trim();
  const ticks = String.fromCharCode(96).repeat(3);
  if (raw.startsWith(ticks)) {
    const firstBreak = raw.indexOf("\n");
    const lastFence = raw.lastIndexOf(ticks);
    if (firstBreak < 0 || lastFence <= firstBreak) return null;
    raw = raw.slice(firstBreak + 1, lastFence).trim();
  }
  let data;
  try { data = JSON.parse(raw); } catch { return null; }
  if (!data || typeof data !== "object") return null;
  if (data.action === "handoff") return { action: "handoff" };
  if (data.action !== "answer" || typeof data.answer !== "string") return null;
  const answer = data.answer.trim();
  if (answer.length < 5 || answer.length > 220) return null;
  return { action: "answer", answer };
}
