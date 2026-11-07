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

// Individual payment/account checks must be handled by a human.
// Keep this before FAQ and AI calls: prompts alone cannot guarantee safe routing.
export function requiresHumanVerification(input) {
  const t=String(input||"").toLowerCase().normalize("NFKC").slice(0,1600);
  const payment=/платёж|платеж|оплат|чек|receipt|пардохт|тўлов|тулов|пул еч|списан|снял|refund|возврат|баргардон|қайтар/u.test(t);
  const account=/аккаунт|account|подписк|обуна|обун|ҳисоб|логин|вход|ворид|кириш|app login|pwa_auth/u.test(t);
  const individual=/мой|моё|моя|моей|мою|менинг|мени|менга|мен|ман|шахси|мой чек|чеки ман|чеким|аккаунтим|аккаунти ман|обунам|my |mine|i paid|у меня|менда|маро/u.test(t);
  const verify=/тасдиқ|подтвержд|проверь|провер|санҷ|текшир|статус|проверка|approved|success|платёж не|оплата не|не пришл|не актив|списал|не работает|не открыв|ошиб|хато|намекунад|кушода намешавад|очилмаяпти|ишламаяпти|қайтар|вернуть|refund/u.test(t);
  if(payment && individual && (verify || /чек|receipt|чеки/u.test(t))) return true;
  // General sign-in troubleshooting belongs to AI; only inspecting a private
  // user record/entitlement requires human identity verification.
  const recordCheck=/проверь|провер|текшир|санҷ|тасдиқ|подтвержд|статус|аккаунтимни кўр|ҳисобамро бин|status|account check/u.test(t);
  if(account && individual && recordCheck) return true;
  return false;
}


// User feedback is a support question, not an operator ticket or proof of a
// broken file. This classifies only UI comments; it never verifies an account.
export function isUiFeedback(input) {
  const s=String(input||"").toLowerCase().normalize("NFKC").slice(0,650);
  const ui=/(?:интерфейс|дизайн|оформлен|экран|страниц|кнопк|шрифт|располож|юзабилити|\bux\b|\bui\b|layout|кўриниш|куриниш|ранг|намуд|интерфейси)/u.test(s);
  const opinion=/(?:не\s+очень|не\s+нрав|нрав|плох|красив|удоб|неудоб|ужас|сложн|передел|улучш|лучше|отзыв|предлож|фикр|ноқулай|нокулай|қулай|кулай|чирой|ёмон|яхши|таклиф|беҳтар|бехтар|зебо|мушкил|feedback)/u.test(s);
  return ui && opinion;
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
  // Some Gemma 4 responses omit action for a normal answer.
  // Never infer a report or operator escalation from an incomplete JSON object.
  const action=data.action===undefined && !("kind" in data) && !("summary" in data) ? "answer" : data.action;
  if (action !== "answer" && action !== "report") return null;
  if (typeof data.answer !== "string") return null;
  const answer = data.answer.trim();
  if (answer.length < 3 || answer.length > 450) return null;
  if (action === "answer") return { action: "answer", answer };
  if (!["bug","feedback"].includes(data.kind) || typeof data.summary !== "string") return null;
  const summary = data.summary.trim();
  if (summary.length < 12 || summary.length > 240) return null;
  return { action:"report", kind:data.kind, answer, summary };
}
