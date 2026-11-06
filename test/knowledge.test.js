import test from "node:test";
import assert from "node:assert/strict";
import { selectKnowledgeTopics, lookupKnowledge, validateKnowledgeRecord } from "../src/knowledge.js";

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
  assert.deepEqual(await lookupKnowledge({KB:{}}, "??"), { status:"unknown_topic" });
  assert.equal((await lookupKnowledge({KB:{ get:async()=>null }}, "платеж")).status,"unavailable");
  assert.equal((await lookupKnowledge({KB:{ get:async()=>({json:async()=>({topic:"accounts",facts:["abc"],source_commit:sha})})}}, "платеж")).status,"unavailable");
  assert.equal(validateKnowledgeRecord({topic:"payments",source_commit:"invalid",facts:["okay"]}, "payments"),null);
});
