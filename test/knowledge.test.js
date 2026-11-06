import test from "node:test";
import assert from "node:assert/strict";
import { selectKnowledgeTopics, lookupKnowledge, validateKnowledgeRecord, selectContextualKnowledgeTopics } from "../src/knowledge.js";

const sha = "c8c1aaf5b2b07b40878017ae8f6bb7a60da4b073";
test("keyword routing covers Uzbek, Tajik and Russian support scenarios", () => {
  assert.deepEqual(selectKnowledgeTopics("Тўловим нега ўтмади?"), ["payments"]);
  assert.deepEqual(selectKnowledgeTopics("Пардохти ман қабул нашуд"), ["payments"]);
  assert.deepEqual(selectKnowledgeTopics("Не получается войти в аккаунт"), ["accounts"]);
  assert.deepEqual(selectKnowledgeTopics("Ошибка в Play Market на Android"), ["android"]);
  assert.deepEqual(selectKnowledgeTopics("iPhone PWA не открывается"), ["pwa"]);
  assert.deepEqual(selectKnowledgeTopics("Как открыть Telegram Mini App?"), ["telegram"]);
  assert.deepEqual(selectKnowledgeTopics("Что такое HSK AI?"), ["general"]);
  assert.deepEqual(selectKnowledgeTopics("Аккаунт и оплата"), ["payments", "accounts"]);
  assert.deepEqual(selectKnowledgeTopics("??"), []);
});

test("R2 lookup reads at most two existing English topic files", async () => {
  const keys = [];
  const env = { KB: { get: async key => {
    keys.push(key);
    const topic = key.slice(10,-5);
    return { json: async () => ({ topic, source_commit: sha, facts: ["Verified " + topic + " detail"] }) };
  } } };
  const v = await lookupKnowledge(env, "Аккаунт ва тўлов");
  assert.equal(v.status,"ok");
  assert.equal(keys.length,2);
  assert.ok(keys.every(k=>k.startsWith("knowledge/")));
  assert.ok(v.facts.every(x=>x.startsWith("Verified")));
});

test("R2 KB fails closed for malformed or unavailable data", async () => {
  assert.deepEqual(await lookupKnowledge({}, "платеж"), { status:"unconfigured" });
  assert.deepEqual(await lookupKnowledge({KB:{get:async()=>null}}, "??"), { status:"unavailable" });
  assert.equal((await lookupKnowledge({KB:{ get:async()=>null }}, "платеж")).status,"unavailable");
  assert.equal((await lookupKnowledge({KB:{ get:async()=>({json:async()=>({topic:"accounts",facts:["abc"],source_commit:sha})})}}, "платеж")).status,"unavailable");
  assert.equal(validateKnowledgeRecord({topic:"payments",source_commit:"invalid",facts:["okay"]}, "payments"),null);
});

test("photo caption about visual UI feedback selects general verified facts",async()=>{
  assert.deepEqual(selectKnowledgeTopics("интерфейс не очень хороший"),["general"]);
  assert.deepEqual(selectKnowledgeTopics("Дизайн и размер шрифта неудобные"),["general"]);
  assert.deepEqual(selectKnowledgeTopics("Интерфейс жуда ноқулай"),["general"]);
  assert.deepEqual(selectKnowledgeTopics("интерфейс и оплата"),["payments"],"specific payment facts take precedence");
  assert.deepEqual(selectKnowledgeTopics("интерфейс и тариф"),["subscriptions"],"specific subscriptions take precedence");
  const v=await lookupKnowledge({KB:{get:async key=>({json:async()=>({
    topic:key.slice(10,-5),source_commit:sha,facts:["Verified general info"]
  })})}},"интерфейс не очень хороший");
  assert.equal(v.status,"ok");
  assert.deepEqual(v.topics,["general"]);
});

test("current question and selected FAQ guide the R2 search; read closest second topic",async()=>{
  const h=[{role:"user",content:"FAQ selected: accounts"},{role:"assistant",content:"Support topic: login"},
    {role:"user",content:"iPhone PWA приложение"}];
  assert.deepEqual(selectContextualKnowledgeTopics("кириш ишламаяпти",h),["accounts","pwa"]);
  assert.deepEqual(selectContextualKnowledgeTopics("андроид",[
    {role:"user",content:"FAQ selected: accounts"}]),["android","accounts"]);
  assert.deepEqual(selectContextualKnowledgeTopics("силкани қайта юборинг",[
    {role:"user",content:"iPhone PWA link"}]),["pwa","general"]);
});

test("missing first R2 file falls back to nearest valid related file",async()=>{
  const visited=[];
  const env={KB:{get:async key=>{
    visited.push(key);
    if(key.endsWith("accounts.json"))return null;
    const topic=key.replace("knowledge/","").replace(".json","");
    return {json:async()=>({topic,source_commit:sha,facts:["Verified related facts"]})};
  }}};
  const r=await lookupKnowledge(env,"войти аккаунт",{history:[]});
  assert.equal(r.status,"ok");
  assert.deepEqual(r.topics,["pwa"]);
  assert.equal(visited.length,2);
});
