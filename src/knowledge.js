// Small, deterministic keyword -> R2 topic router. No embedding, D1 index or extra AI call.
export const KNOWLEDGE_TOPICS = Object.freeze([
  "payments", "subscriptions", "accounts", "android", "pwa", "telegram", "general"
]);

const TERMS = {
  payments: [
    /плат[еёи]/u, /оплат/u, /пул/u, /тўлов/u, /тулов/u, /пардохт/u,
    /чек/u, /карта/u, /card/u, /receipt/u, /transaction/u,
    /bank/u, /visa/u, /alipay/u, /wechat/u, /payment/u
  ],
  subscriptions: [
    /подпис/u, /обуна/u, /обун/u, /pro\b/u, /tarif/u, /тариф/u,
    /plan/u, /discount/u, /скидк/u, /чегирм/u, /нарх/u, /цена/u,
    /renew/u, /продл/u, /renewal/u, /subscription/u
  ],
  accounts: [
    /аккаунт/u, /account/u, /логин/u, /войти/u, /вход/u, /кир/u,
    /парол/u, /google/u, /apple/u, /авториз/u, /регистра/u,
    /удалить/u, /ўчир/u, /учир/u, /identity/u
  ],
  android: [
    /android/u, /андроид/u, /плеймаркет/u, /play market/u, /google play/u,
    /apk\b/u, /aab\b/u, /виджет/u, /widget/u, /установ/u, /ўрнат/u
  ],
  pwa: [
    /iphone/u, /айфон/u, /\bios\b/u, /safari/u, /\bpwa\b/u,
    /браузер/u, /home screen/u, /рабочий стол/u, /экранга қўш/u
  ],
  telegram: [
    /telegram/u, /телеграм/u, /\bbot\b/u, /бот/u, /mini app/u, /мини апп/u,
    /miniapp/u, /реферал/u, /referral/u
  ],
  general: [
    /instagram/u, /инстаграм/u, /tiktok/u, /тикток/u, /youtube/u, /ютуб/u, /ютюб/u, /соцсет/u, /ижтимоий/u, /сайт/u, /website/u,
    /\bhsk\b/u, /хск/u, /курс/u, /lesson/u, /дарс/u, /урок/u,
    /хитой/u, /китай/u, /chinese/u, /study/u, /дост\/п/u,
    // Visual UI/UX comments and unsolicited user feedback also belong to support.
    /интерфейс/u, /дизайн/u, /оформлен/u, /удобн/u, /юзабилити/u,
    /\bux\b/u, /\bui\b/u, /layout/u, /feedback/u, /отзыв/u,
    /мулоҳиза/u, /мулохаза/u, /таклиф/u, /пешниҳод/u,
    /кўриниш/u, /куриниш/u, /қулай/u, /кулай/u, /ноқулай/u, /нокулай/u,
    /шрифт/u, /кнопк/u, /кнопка/u, /ранглар/u, /ранг/u, /цвет/u,
    /экран/u, /страниц/u
  ]
};

export function selectKnowledgeTopics(input, maximum = 2) {
  const normalized = String(input || "").toLowerCase().normalize("NFKC").slice(0, 1600);
  if (!normalized.trim()) return [];
  const hits = KNOWLEDGE_TOPICS.map((topic, order) => ({
    topic, order, score: TERMS[topic].reduce((count, re) => count + Number(re.test(normalized)), 0)
  })).filter(x => x.score > 0).sort((a, b) => b.score - a.score || a.order - b.order);
  if (!hits.length) return [];
  // General facts are a low-priority fallback, not a replacement for a specific topic.
  const specific = hits.filter(x => x.topic !== "general");
  const selected = (specific.length ? specific : hits).slice(0, Math.min(2, Math.max(1, maximum)));
  return selected.map(x => x.topic);
}

export function validateKnowledgeRecord(record, topic) {
  if (!record || typeof record !== "object" || record.topic !== topic) return null;
  if (!/^[a-f0-9]{40}$/.test(String(record.source_commit || ""))) return null;
  if (!Array.isArray(record.facts) || !record.facts.length) return null;
  const facts = record.facts
    .filter(x => typeof x === "string" && x.trim())
    .map(x => x.trim().slice(0, 450))
    .slice(0, 24);
  return facts.length ? { topic, facts, source_commit: record.source_commit } : null;
}

// Use the current question first, then the latest user/FAQ context.
// If one topic is selected, also read the closest related R2 file.
// At most two objects per request: no embeddings, extra AI calls or main backend load.
const RELATED = Object.freeze({
  payments:["subscriptions","accounts"],
  subscriptions:["payments","general"],
  accounts:["pwa","android"],
  android:["accounts","general"],
  pwa:["general","accounts"],
  telegram:["accounts","general"],
  general:[]
});

export function selectContextualKnowledgeTopics(input, history = []) {
  const direct=selectKnowledgeTopics(input);
  const previous=history.filter(x=>x.role==="user")
    .slice(-4).map(x=>String(x.content||"")).reverse();
  const past=previous.flatMap(text=>selectKnowledgeTopics(text)).filter((v,i,a)=>a.indexOf(v)===i);
  const selected=direct.length?direct.slice():past.slice(0,1);
  if (!selected.length) selected.push("general");
  for(const topic of [...past,...(RELATED[selected[0]]||[])]){
    if(selected.length>=2)break;
    if(topic!==selected[0]&&!selected.includes(topic))selected.push(topic);
  }
  return selected.slice(0,2);
}

export async function lookupKnowledge(env, input, { history = [] } = {}) {
  if (!env.KB) return { status:"unconfigured" };
  const topics=selectContextualKnowledgeTopics(input,history);
  const loaded=[];
  for(const topic of topics){
    try {
      const object=await env.KB.get("knowledge/"+topic+".json");
      if (!object) continue;
      const valid=validateKnowledgeRecord(await object.json(),topic);
      if(valid)loaded.push(valid);
    }catch { /* Try the second, related topic rather than stopping prematurely. */ }
  }
  if (!loaded.length) return { status:"unavailable" };
  return { status:"ok",topics:loaded.map(x=>x.topic),facts:loaded.flatMap(x=>x.facts).slice(0,32) };
}
