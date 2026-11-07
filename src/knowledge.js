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
    /miniapp/u, /канал/u, /channel/u, /новост/u, /янгил/u, /хабар/u, /ахбор/u, /реферал/u, /referral/u
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
  const current=String(input||"").toLowerCase().normalize("NFKC").trim();
  const direct=selectKnowledgeTopics(current);
  const previous=history.filter(x=>x.role==="user")
    .slice(-6).map(x=>String(x.content||"").toLowerCase().normalize("NFKC")).reverse();
  const past=previous.flatMap(text=>selectKnowledgeTopics(text)).filter((v,i,a)=>a.indexOf(v)===i);
  // Evidence-only image messages have no useful topic keywords of their own.
  // The actual user question, not the generic Vision filename, sets the KB focus.
  const screenshotOnly=/^(?:hsk ai screenshot|screenshot|скриншот|сурат|расм)$/u.test(current);
  const followUp=screenshotOnly || (!direct.length && current.length<90) ||
    /^(?:лекин|аммо|но|но вот|но у меня|бироқ|барибир|ҳали|хали|вапше|вапще|барибир)/u.test(current);
  const proPattern=/\bpro\b|\bpro\s+olish\b|про(?![\p{L}])|подпис|обуна|обун|тариф|лимит|purchase|subscription/u;
  const playPattern=/google\s*play|play\s*market|плей\s*маркет|плеймаркет|гугл\s*плей|android|андроид/u;
  const purchasePattern=/сотиб\s*ол|покуп|купить|олиш|оплат|тўлов|тулов|пардохт|платеж|payment|checkout|топа\s*ол|кўринма|куринма|йўқ|ёк|нет|куда|қаер|каер/u;
  const proRelevant=proPattern.test(current) ||
    (followUp && proPattern.test(previous.join(" ")));
  const androidRelevant=playPattern.test(current) ||
    (followUp && playPattern.test(previous.join(" ")));
  const otherPlatform=/iphone|айфон|ios\b|\bpwa\b|safari/u.test(current);
  if(proRelevant && androidRelevant && !otherPlatform)
    return ["android","subscriptions","pwa"];
  if(proRelevant && (screenshotOnly || purchasePattern.test(current)))
    return ["subscriptions","payments","pwa"];
  const selected=(screenshotOnly && past.length) ? past.slice(0,1) :
    direct.length ? direct.slice() : past.slice(0,1);
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
  // Preserve evidence from all three relevant channels instead of taking
  // only the first 32 facts (which previously buried PWA facts behind manuals).
  const facts=loaded.length===3 ?
    loaded.flatMap((item,i)=>item.facts.slice(0,[12,10,10][i])) :
    loaded.flatMap(item=>item.facts).slice(0,32);
  return { status:"ok",topics:loaded.map(x=>x.topic),facts };
}


// Discover every approved top-level KB topic from R2, including new topic
// files created by the independent KB synchronizer. Backups and sync_state
// are not product evidence, and are NEVER loaded into model context.
const KB_TOPIC_RE=/^knowledge\/([a-z][a-z0-9_-]{0,63})\.json$/;
const RESERVED_TOPICS=new Set(["sync_state","index","manifest","backup","secrets","private"]);
const CATALOGUE_MAX_PAGES=20;

export async function discoverKnowledgeTopics(env) {
  if (!env.KB) return {status:"unconfigured",topics:[]};
  if (typeof env.KB.list!=="function")
    return {status:"fallback",topics:[...KNOWLEDGE_TOPICS]};
  let cursor, pages=0;
  const topics=new Set();
  const visited=new Set();
  try {
    do {
      const options={prefix:"knowledge/",delimiter:"/",limit:1000};
      if(cursor) options.cursor=cursor;
      const list=await env.KB.list(options);
      if (!Array.isArray(list?.objects)) throw new Error("invalid_r2_catalogue");
      for(const item of list.objects){
        const match=KB_TOPIC_RE.exec(String(item.key||""));
        if(match&&!RESERVED_TOPICS.has(match[1])&&!match[1].startsWith("_"))
          topics.add(match[1]);
      }
      pages++;
      if(!list.truncated)break;
      if(!list.cursor || visited.has(list.cursor)) throw new Error("invalid_r2_cursor");
      visited.add(list.cursor);
      cursor=list.cursor;
    } while(pages<CATALOGUE_MAX_PAGES);
    if(pages>=CATALOGUE_MAX_PAGES && cursor)
      return {status:"partial",topics:[...topics]};
    return {status:"ok",topics:[...topics]};
  }catch{
    // An R2 listing outage must not prevent retrieval of the seven known
    // verified product facts. Never treat backup or private keys as topics.
    return {status:"fallback",topics:[...new Set([...topics,...KNOWLEDGE_TOPICS])]};
  }
}

export function rankKnowledgeTopics(input, history=[], discovered=KNOWLEDGE_TOPICS) {
  const catalogue=[...new Set(discovered.filter(x=>
    /^[a-z][a-z0-9_-]{0,63}$/.test(x)&&!RESERVED_TOPICS.has(x)
  ))];
  const query=String(input||"").toLowerCase().normalize("NFKC");
  const prior=history.filter(x=>x.role==="user").slice(-6)
    .map(x=>String(x.content||"").toLowerCase().normalize("NFKC")).join(" ");
  const priority=selectContextualKnowledgeTopics(input,history).filter(x=>catalogue.includes(x));
  // New topic files are discoverable without a code update. If a topic name
  // is explicitly mentioned, put it ahead of less-relevant generic files.
  const custom=catalogue.filter(x=>!KNOWLEDGE_TOPICS.includes(x))
    .map(topic=>{
      const tokens=topic.split(/[_-]/).filter(x=>x.length>2);
      const direct=tokens.filter(x=>query.includes(x)).length;
      const contextual=tokens.filter(x=>prior.includes(x)).length;
      return {topic,score:direct*3+contextual};
    }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score)
    .map(x=>x.topic);
  const direct=selectKnowledgeTopics(query,KNOWLEDGE_TOPICS.length).filter(x=>catalogue.includes(x));
  const past=selectKnowledgeTopics(prior,KNOWLEDGE_TOPICS.length).filter(x=>catalogue.includes(x));
  return [...new Set([...custom,...priority,...direct,...past,...catalogue])];
}

export async function readKnowledgeTopics(env, topics) {
  const records=[];
  for(const topic of [...new Set(topics)]){
    if(!/^[a-z][a-z0-9_-]{0,63}$/.test(topic)||RESERVED_TOPICS.has(topic))continue;
    try{
      const object=await env.KB.get("knowledge/"+topic+".json");
      if(!object)continue;
      const valid=validateKnowledgeRecord(await object.json(),topic);
      if(valid)records.push(valid);
    }catch{
      // Invalid or missing documents are skipped; later verified files remain
      // accessible to the model. Never use arbitrary R2 objects as evidence.
    }
  }
  return records;
}

export function knowledgeEvidenceFacts(records,maxChars=90000) {
  // Round-robin sampling prevents the early files from crowding out all
  // evidence from newly discovered topics. With the current KB every valid
  // fact fits; limits avoid unbounded model input if the catalogue grows.
  const out=[];
  let size=0;
  const maxDepth=Math.max(0,...records.map(x=>x.facts.length));
  for(let i=0;i<maxDepth;i++){
    for(const record of records){
      const fact=record.facts[i];
      if(!fact)continue;
      const entry="["+record.topic+"] "+fact;
      if(size+entry.length>maxChars)continue;
      out.push(entry);size+=entry.length;
    }
  }
  return out;
}
