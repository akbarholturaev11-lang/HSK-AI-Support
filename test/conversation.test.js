import test from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeConversationText,
  CONTEXT_TTL_SECONDS, CONTEXT_MESSAGES,
  loadRecentConversation, saveConversationExchange
} from "../src/conversation.js";

test("context stores only sanitized short excerpts", () => {
  assert.equal(CONTEXT_TTL_SECONDS,3600);
  assert.equal(CONTEXT_MESSAGES,5);
  assert.equal(sanitizeConversationText("Мой CVV 123"),null);
  assert.equal(sanitizeConversationText("Мой пароль не работает"),null);
  assert.equal(sanitizeConversationText("Позвоните +992900000000"),null);
  assert.equal(sanitizeConversationText("Помогите открыть https://example.org"),"Помогите открыть [link]");
  assert.equal(sanitizeConversationText("У меня проблема: example@site.org"),"У меня проблема: [email]");
});

test("context returns last five only within one hour and in chronological order", async () => {
  const values = [
    {role:"assistant",text:"b4"}, {role:"user",text:"a4"},
    {role:"assistant",text:"b3"}, {role:"user",text:"a3"},
    {role:"assistant",text:"b2"}
  ];
  let sql = "";
  let args = [];
  const env = { DB: { prepare(query) { sql=query; return { bind(...v) { args=v; return {
    async all(){return {results:values}},
  }; } }; } } };
  const v=await loadRecentConversation(env,9,5000);
  assert.deepEqual(v.map(x=>x.content),["b2","a3","b3","a4","b4"]);
  assert.match(sql,/LIMIT 5/);
  assert.deepEqual(args,[9,1400]);
  assert.deepEqual(await loadRecentConversation({},9),[]);
});

test("safe exchange write uses parameterized D1 SQL", async () => {
  const writes=[];
  const env={DB:{
    prepare(sql){ return {bind(...args){return {sql,args}}}; },
    async batch(items){writes.push(...items);}
  }};
  assert.equal(await saveConversationExchange(env,42,"Ошибка после входа","Пожалуйста, проверьте вход.",5000),true);
  assert.equal(writes.length,2);
  assert.equal(writes[0].args[0],42);
  assert.equal(writes[1].args[1],"assistant");
  assert.equal(await saveConversationExchange(env,42,"Пароль: 123456","ок",5000),false);
});
