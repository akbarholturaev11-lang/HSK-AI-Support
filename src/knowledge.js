// The seven small, English-only R2 files are the sole factual source for AI answers.
// Intentionally use deterministic multilingual keyword selection: no extra AI classifier.
const PATTERNS = {
  payments: [/pay(?:ment|ing)?/iu, /refund/iu, /плат[еёж]/iu, /оплат/iu, /деньг[иа]/iu, /списал/iu, /пардохт/iu, /т[ўу]лов/iu, /пул ечил/iu, /пардохт/iu, /alipay/iu, /wechat/iu, /visa/iu, /card/iu, /карт[аы]/iu, /корт/iu, /чек/iu, /receipt/iu, /qr.code/iu],
  subscriptions: [/subscri/iu, /pro(?:\b|[ -]plan)/iu, /trial/iu, /тариф/iu, /обун/iu, /подпис/iu, /пробн/iu, /10[ -]?дн/iu, /1[ -]?месяц/iu, /абон/iu, /нарх/iu, /цена/iu, /скидк/iu],
  accounts: [/accou?nt/iu, /sign.?in/iu, /log.?in/iu, /oauth/iu, /password/iu, /аккаунт/iu, /логин/iu, /кириш/iu, /ворид/iu, /ҳисоб/iu, /вход/iu, /парол/iu, /регистрац/iu, /регистрат/iu, /удал[ие]/iu, /ўчир/iu],
  android: [/android/iu, /андроид/iu, /андро[ий]д/iu, /play.?market/iu, /play.?store/iu, /\bapk\b/iu, /\baab\b/iu, /samsung/iu, /xiaomi/iu, /redmi/iu, /андроида/iu],
  pwa: [/\bpwa\b/iu, /iphone/iu, /айфон/iu, /\bios\b/iu, /safari/iu, /browser/iu, /браузер/iu, /веб.?приложен/iu, /веб.?илова/iu, /apple/iu],
  telegram: [/telegram/iu, /телеграм/iu, /mini.?app/iu, /мини.?апп/iu, /бот/iu, /referral/iu, /реферал/iu, /таклиф/iu],
  general: [/hsk.?ai/iu, /хск.?аи/iu, /китайск/iu, /хитой/iu, /чин[ӣи]/iu, /learn/iu, /курс/iu, /урок/iu, /дарс/iu, /ўрган/iu, /обуч/iu, /функц/iu, /что это/iu, /нима бу/iu]
};

const TOPICS = new Set(Object.keys(PATTERNS));
const MAX_FACTS = 16;

export function selectTopics(text) {
  const input = String(text || "").slice(0, 1600).toLowerCase();
  if (!input.trim()) return [];
  const ranks = Object.entries(PATTERNS).map(([topic, pats]) =>
    ({ topic, score: pats.reduce((n, p) => n + (p.test(input) ? 1 : 0), 0) })
  ).filter((x) => x.score > 0);
  // General facts supplement product questions, but never displace a specific topic.
  ranks.sort((a, b) => (a.topic === "general") - (b.topic === "general") || b.score - a.score);
  return ranks.slice(0, 2).map((x) => x.topic);
}

function validateDocument(obj, topic) {
  if (!obj || obj.topic !== topic || !TOPICS.has(topic) ||
      !/^[a-f0-9]{40}$/i.test(String(obj.source_commit || "")) ||
      !Array.isArray(obj.facts) || obj.facts.length < 1 || obj.facts.length > MAX_FACTS) return null;
  const facts = obj.facts.map((x) => typeof x === "string" ? x.trim() : "");
  if (facts.some((x) => !x || x.length > 600)) return null;
  return facts;
}

export async function loadKnowledge(env, question, history = []) {
  if (!env.KB || typeof env.KB.get !== "function") return null;
  const context = [...history.slice(-5).map((x) => x.content), question].join(" ");
  const topics = selectTopics(context);
  if (!topics.length) return null; // Never improvise without a relevant topic.
  const facts = [];
  try {
    for (const topic of topics) {
      const file = await env.KB.get("knowledge/" + topic + ".json");
      if (!file) return null;
      const parsed = await file.json();
      const validated = validateDocument(parsed, topic);
      if (!validated) return null;
      facts.push(...validated);
    }
  } catch {
    console.warn("support_kb_unavailable");
    return null; // Handoff instead of fabricated information.
  }
  return { topics, facts };
}
