import test from "node:test";
import assert from "node:assert/strict";
import { answerWithAi, backupEnabled, reserveBackupBudget } from "../src/ai-router.js";

const knowledge = { facts: ["HSK AI is a product for learning Chinese."] };
const decision = (answer) => ({ response: JSON.stringify({ action:"answer", answer }) });

function envWithBudget() {
  const used = new Map();
  const DB = { prepare(sql) {
    assert.match(sql, /INSERT INTO quotas/);
    return { bind(scope, day, max) {
      return { async run() {
        const k = scope + ":" + day, n = used.get(k) || 0;
        if (n >= max) return { meta:{ changes:0 } };
        used.set(k,n+1); return { meta:{ changes:1 } };
      } };
    } };
  } };
  return { DB, used };
}

test("primary Workers AI uses Cloudflare gateway and requires valid short JSON", async () => {
  const calls = [];
  const env = { AI: { run: async (...args) => {
    calls.push(args);
    return decision("HSK AI ёрдам беради.");
  } }, AI_GATEWAY_ID:"default" };
  assert.equal(await answerWithAi(env,"uz","HSK AI нима?",[],knowledge),"HSK AI ёрдам беради.");
  assert.equal(calls.length, 1);
  assert.match(calls[0][0], /^@cf\//);
  assert.equal(calls[0][2].gateway.skipCache, true);
  assert.match(calls[0][1].messages[0].content,/ONLY source/);
});

test("a model's explicit handoff never triggers a paid fallback", async () => {
  let count = 0;
  const env = { AI:{run:async()=>{count++;return {response:'{"action":"handoff","answer":""}'};} },
    MINIMAX_BACKUP_ENABLED:"true",BACKUP_BILLING_APPROVED:"true",GATEWAY_SPEND_LIMITS_CONFIRMED:"true" };
  assert.equal(await answerWithAi(env,"ru","Аккаунт",[],knowledge),null);
  assert.equal(count,1);
});

test("backup is disabled until billing and spend guards are explicitly set", async () => {
  const calls = [];
  const env = { AI:{ run:async(model)=>{calls.push(model);throw Error("quota");} } };
  assert.equal(backupEnabled(env),false);
  assert.equal(await answerWithAi(env,"tj","HSK AI",[],knowledge),null);
  assert.equal(calls.length,1);
});

test("MiniMax is called once after primary failure when both gates and budget allow", async () => {
  const { DB,used } = envWithBudget();
  const models=[];
  const env = { DB,
    MINIMAX_BACKUP_ENABLED:"true",
    BACKUP_BILLING_APPROVED:"true",
    GATEWAY_SPEND_LIMITS_CONFIRMED:"true",
    AI:{run:async(model,req)=>{
      models.push(model);
      if(models.length===1) throw Error("worker-ai-429");
      assert.equal(req.max_completion_tokens,512);
      assert.equal(req.reasoning_effort, "low");
      return decision("Муроҷиатингиз қабул қилинди.");
    }}
  };
  assert.equal(await answerWithAi(env,"uz","HSK AI",[],knowledge),"Муроҷиатингиз қабул қилинди.");
  assert.deepEqual(models,["@cf/google/gemma-4-26b-a4b-it","minimax/m3.1-flash"]);
  assert.equal(used.size,2);
});

test("reservations enforce conservative $0.20/day, $3/month per-call ceilings", async () => {
  const env = envWithBudget();
  for (let i=0;i<20;i++) assert.equal(await reserveBackupBudget(env,Date.UTC(2026,10,6)),true);
  assert.equal(await reserveBackupBudget(env,Date.UTC(2026,10,6)),false);
  assert.equal(env.used.get("backup-cent-daily:2026-11-06"),20);
});
