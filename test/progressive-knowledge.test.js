import test from "node:test";
import assert from "node:assert/strict";
import {AI_NO_FACTS,generateSupportAnswer} from "../src/ai.js";
import {discoverKnowledgeTopics,rankKnowledgeTopics,readKnowledgeTopics,knowledgeEvidenceFacts} from "../src/knowledge.js";
import {parseAiDecision} from "../src/logic.js";

const sha="c8c1aaf5b2b07b40878017ae8f6bb7a60da4b073";
function fixture(names, onAI, {list=true,missing=[]}={}){
  const scanned=[],models=[],quota=[];
  const records=new Map(names.map(n=>[n,{topic:n,source_commit:sha,facts:[
    "Verified "+n+" description.", "Verified "+n+" details only."
  ]}]));
  const KB={
    async get(key){
      scanned.push(key);
      const topic=key.slice(10,-5);
      if(missing.includes(topic)||!records.has(topic))return null;
      return {json:async()=>records.get(topic)};
    }
  };
  if(list) KB.list=async()=>({objects:[
    ...names.map(n=>({key:"knowledge/"+n+".json"})),
    {key:"knowledge/sync_state.json"},
    {key:"knowledge/backup/2026-11-07/accounts.json"},
    {key:"logs/private.json"}
  ],truncated:false});
  const env={KB,AI:{async run(model,request){
    models.push(request);
    return {response:JSON.stringify(await onAI(models.length,request))};
  }}};
  const claimQuota=async(_env,key)=>{quota.push(key);return true;};
  return {env,scanned,models,quota,claimQuota,records};
}

test("discover all public top-level knowledge files, including brand-new topics, never backups/metadata",async()=>{
  const seen=[];
  const env={KB:{async list(opts){
    seen.push(opts);
    return seen.length===1?
      {objects:[{key:"knowledge/android.json"},{key:"knowledge/backup/2026-11-07/android.json"},
        {key:"knowledge/sync_state.json"}],truncated:true,cursor:"next"}:
      {objects:[{key:"knowledge/new_feature.json"},{key:"knowledge/../../private.json"},
        {key:"knowledge/a/b.json"}],truncated:false};
  }}};
  const found=await discoverKnowledgeTopics(env);
  assert.equal(found.status,"ok");
  assert.deepEqual(found.topics,["android","new_feature"]);
  assert.equal(seen.length,2);
  assert.equal(seen[1].cursor,"next");
  assert.equal(seen[0].delimiter,"/");
  assert.deepEqual((await discoverKnowledgeTopics({KB:{}})).topics.includes("pwa"),true);
});

test("relevance ranking opens a newly added topic first when its name matches question",()=>{
  const ranked=rankKnowledgeTopics("barcode scanner does not open",[],
    ["general","payments","barcode_scanner","android"]);
  assert.equal(ranked[0],"barcode_scanner");
  assert.deepEqual(new Set(ranked),new Set(["general","payments","barcode_scanner","android"]));
});

test("AI can explicitly request a new R2 file and answer after it is read",async()=>{
  const topics=["general","android","payments","new_feature","pwa","subscriptions"];
  const x=fixture(topics,async(n,request)=>{
    if(n===1){
      assert.ok(!request.messages[0].content.includes("[new_feature] Verified new_feature"));
      assert.match(request.messages[0].content,/new_feature/);
      return {action:"search_more",topics:["new_feature"]};
    }
    assert.ok(request.messages[0].content.includes("[new_feature] Verified new_feature description."));
    return {action:"answer",answer:"Маълумот янги билим файлида тасдиқланган."};
  });
  const result=await generateSupportAnswer(x.env,{userId:17,lang:"uz",
    input:"HSK AI ilovasida yordam kerak",claimQuota:x.claimQuota});
  assert.equal(result,"Маълумот янги билим файлида тасдиқланган.");
  assert.equal(x.models.length,2);
  assert.equal(x.scanned.includes("knowledge/new_feature.json"),true);
  assert.equal(x.scanned.some(k=>k.includes("backup/")),false);
  assert.equal(x.quota.filter(q=>q==="ai-user:17").length,1);
  assert.equal(x.quota.filter(q=>q==="ai-global").length,1);
});

test("a premature handoff triggers the next documents instead of immediately dismissing the learner",async()=>{
  const topics=["general","accounts","android","payments","subscriptions","pwa","telegram"];
  const x=fixture(topics,async(n,req)=>n===1?
    {action:"handoff"}:
    {action:"answer",answer:"Иккинчи файллар тўпламида жавоб топилди."});
  const result=await generateSupportAnswer(x.env,{userId:18,lang:"uz",
    input:"HSK AI версиясининг номаълум имконияти борми?",claimQuota:x.claimQuota});
  assert.equal(result,"Иккинчи файллар тўпламида жавоб топилди.");
  assert.equal(x.models.length,2);
  assert.ok(x.scanned.length>3);
});

test("all known R2 documents are scanned before final no-verified-information decision",async()=>{
  const topics=["general","accounts","android","payments","subscriptions","pwa","telegram","experimental"];
  const x=fixture(topics,async()=>({action:"handoff"}));
  const result=await generateSupportAnswer(x.env,{userId:19,lang:"ru",
    input:"Do you have a verified public source for a nonexistent feature?",claimQuota:x.claimQuota});
  assert.equal(result,AI_NO_FACTS);
  assert.deepEqual(new Set(x.scanned),new Set(topics.map(t=>"knowledge/"+t+".json")));
  assert.ok(x.models.length>=2);
  assert.ok(x.models.length<=4);
  assert.equal(x.quota.filter(q=>q==="ai-user:19").length,1);
});

test("missed/corrupted topic cannot poison the AI and other R2 documents are still searched",async()=>{
  const topics=["general","accounts","pwa","feature_faq"];
  const x=fixture(topics,async(n)=>n===1?{action:"search_more",topics:["feature_faq"]}:
    {action:"answer",answer:"Тасдиқланган маълумот кейинги билим бўлимида топилди."},{missing:["general"]});
  x.records.set("accounts",{topic:"accounts",source_commit:"incorrect",facts:["Unverified secret"]});
  const result=await generateSupportAnswer(x.env,{userId:20,lang:"uz",input:"FAQ of HSK AI",claimQuota:x.claimQuota});
  assert.match(result,/^Тасдиқланган маълумот кейинги билим бўлимида топилди/);
  assert.ok(x.models.every(m=>!m.messages[0].content.includes("Unverified secret")));
});

test("normal answer uses nearest records and avoids unnecessary broad search",async()=>{
  const topics=["android","subscriptions","pwa","telegram","general","accounts","payments"];
  const x=fixture(topics,async()=>({action:"answer",answer:"Тасдиқланган факт асосида саволга жавоб."}));
  const result=await generateSupportAnswer(x.env,{userId:21,lang:"uz",
    input:"Android Google Play версиясида Pro сотиб олиш бўлими йўқ",claimQuota:x.claimQuota});
  assert.equal(result,"Тасдиқланган факт асосида саволга жавоб.");
  assert.equal(x.models.length,1);
  assert.equal(x.scanned.length,3);
  assert.equal(x.quota.length,2);
});

test("model cannot read unsafe objects outside knowledge namespace",async()=>{
  const x=fixture(["general","feature_faq"],async(n)=>n===1?
    {action:"search_more",topics:["../private","sync_state","backup","feature_faq"]}:
    {action:"answer",answer:"Маълумот топилди."});
  const result=await generateSupportAnswer(x.env,{userId:22,lang:"ru",input:"HSK support question",claimQuota:x.claimQuota});
  assert.equal(result,AI_NO_FACTS,"no other verified topics remain; fail closed");
  assert.ok(x.scanned.every(k=>/^knowledge\/[a-z][a-z0-9_-]*\.json$/.test(k)));
  assert.ok(!x.scanned.some(k=>/sync_state|backup|private/.test(k)));
  assert.deepEqual(parseAiDecision(JSON.stringify({action:"search_more",topics:["../private","feature_faq"]})),
    {action:"search_more",topics:["feature_faq"]});
});

test("verified knowledge must exist before AI quota is spent",async()=>{
  const x=fixture(["general","payments"],async()=>({action:"answer",answer:"Not reached."}),{missing:["general","payments"]});
  const result=await generateSupportAnswer(x.env,{userId:23,lang:"ru",input:"Does HSK AI offer invoices?",claimQuota:x.claimQuota});
  assert.equal(result,null);
  assert.equal(x.models.length,0);
  assert.equal(x.quota.length,0);
});

test("balanced evidence includes later topic facts rather than dropping them behind first files",()=>{
  const records=["a","b","c"].map(topic=>({topic,facts:Array.from({length:15},(_,i)=>topic+i)}));
  const sampled=knowledgeEvidenceFacts(records,1000);
  assert.ok(sampled.some(x=>x==="[c] c14"));
  assert.ok(sampled.some(x=>x==="[a] a14"));
  assert.equal(sampled[0],"[a] a0");
});
