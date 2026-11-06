import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

function stub() {
  const calls = [], processed = new Set(), users = new Map(), tickets = new Map(), links = new Map(), quotas = new Map(), settings = new Map(), conversations = [];
  let nextTicket = 1;
  const DB = { async batch(statements) { for (const stmt of statements) await stmt.run(); }, prepare(sql) { return {
    async first() {
      if (sql.startsWith("SELECT value FROM service_settings")) {
        const key = sql.match(/key='([^']+)'/)?.[1];
        const entry = settings.get(key);
        return entry ? { value: entry.value } : null;
      }
      return null;
    },
    bind(...args) { return {
    async run() {
      if (sql.startsWith("INSERT INTO ai_conversation")) {
        conversations.push({tg_id:args[0],role:args[1],text:args[2],created_at:args[3]});
        return {meta:{changes:1}};
      }
      if (sql.startsWith("DELETE FROM ai_conversation")) {
        for (let i=conversations.length-1;i>=0;i--)
          if (conversations[i].tg_id===args[0]) conversations.splice(i,1);
        return {meta:{changes:1}};
      }
      if (sql.startsWith("INSERT INTO service_settings")) {
        const key = sql.match(/VALUES\('([^']+)'/)?.[1];
        if (key === "webhook_last_attempt") {
          const previous = settings.get(key);
          if (previous && previous.updated_at > args[1]) return { meta: { changes:0 } };
          settings.set(key,{value:"1",updated_at:args[0]});
          return { meta:{ changes:1 } };
        }
        settings.set(key,{value:args[0],updated_at:args[1]});
        return { meta:{ changes:1 } };
      }
      if (sql.startsWith("INSERT OR IGNORE INTO processed_updates")) {
        if (processed.has(args[0])) return { meta: { changes: 0 } };
        processed.add(args[0]); return { meta: { changes: 1 } };
      }
      if (sql.startsWith("DELETE FROM processed_updates")) {
        processed.delete(args[0]); return { meta: { changes: 1 } };
      }
      if (sql.startsWith("INSERT INTO support_users")) {
        users.set(args[0], { lang: args[1], source: args[2] });
        return { meta: { changes: 1 } };
      }
      if (sql.startsWith("INSERT INTO quotas")) {
        const k = args[0] + ":" + args[1], n = quotas.get(k) || 0;
        if (n >= args[2]) return { meta: { changes: 0 } };
        quotas.set(k, n + 1); return { meta: { changes: 1 } };
      }
      if (sql.startsWith("INSERT OR IGNORE INTO tickets")) {
        if ([...tickets.values()].some(t => t.tg_id === args[0] && t.status === "open")) return { meta: { changes: 0 } };
        const id = nextTicket++;
        tickets.set(id, { id, tg_id: args[0], lang: args[1], source: args[2], status: "open" });
        return { meta: { changes: 1 } };
      }
      if (sql.startsWith("INSERT OR REPLACE INTO admin_links")) {
        links.set(args[0], args[1]); return { meta: { changes: 1 } };
      }
      if (sql.startsWith("UPDATE tickets SET status")) {
        const t = tickets.get(args[1]); if (t) t.status = "closed";
        return { meta: { changes: t ? 1 : 0 } };
      }
      return { meta: { changes: 1 } };
    },
    async all() {
      if (sql.startsWith("SELECT role,text FROM ai_conversation")) {
        return {results:conversations.filter(x=>x.tg_id===args[0]&&x.created_at>=args[1])
          .slice(-5).reverse().map(x=>({role:x.role,text:x.text}))};
      }
      return {results:[]};
    },
    async first() {
      if (sql.startsWith("SELECT value FROM service_settings")) {
        const key = sql.match(/key='([^']+)'/)?.[1];
        const entry = settings.get(key);
        return entry ? { value: entry.value } : null;
      }
      if (sql.startsWith("SELECT lang,source FROM support_users")) return users.get(args[0]) || null;
      if (sql.startsWith("SELECT id,tg_id,lang,source FROM tickets"))
        return [...tickets.values()].find(t => t.tg_id === args[0] && t.status === "open") || null;
      if (sql.startsWith("SELECT a.ticket_id")) {
        const id = links.get(args[0]), t = tickets.get(id);
        return t ? { ticket_id: id, tg_id: t.tg_id, lang: t.lang, status: t.status } : null;
      }
      return null;
    }
  }; } }; } };
  return {
    env: { DB, BOT_TOKEN: "fake_token", WEBHOOK_SECRET: "secret", ADMIN_CHAT_ID: "-100234", AI_MODEL: "fake",
      KB: { async get(key) {const topic=key.slice(10,-5);return {async json(){return {topic,source_commit:"c8c1aaf5b2b07b40878017ae8f6bb7a60da4b073",facts:["HSK AI is a Chinese language learning product."]}}}}}
    },
    calls, users, tickets, links, settings, quotas, conversations
  };
}

async function call(env, update, secret = "secret") {
  return worker.fetch(new Request("https://bot.example/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "X-Telegram-Bot-Api-Secret-Token": secret },
    body: JSON.stringify(update)
  }), env);
}

test("health responds; bad webhook secret returns 403", async () => {
  const { env } = stub();
  assert.equal((await worker.fetch(new Request("https://bot.example/health"), env)).status, 200);
  assert.equal((await call(env, { update_id: 1 }, "wrong")).status, 403);
});

test("deep link locale/source and deduplication; no HSK AI backend calls", async () => {
  const { env, users, calls } = stub();
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, data: JSON.parse(init.body) });
    return Response.json({ ok: true, result: { message_id: 101 } });
  };
  try {
    const update = { update_id: 100, message: { chat: { id: 42, type: "private" }, from: { id: 42, language_code: "uz" }, message_id: 1, text: "/start ru_android" } };
    assert.equal((await call(env, update)).status, 200);
    assert.deepEqual(users.get(42), { lang: "ru", source: "android" });
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /^https:\/\/api\.telegram\.org/);
    assert.match(calls[0].data.text, /Здравствуйте/);
    assert.equal((await call(env, update)).status, 200);
    assert.equal(calls.length, 1);
  } finally { globalThis.fetch = original; }
});

test("explicit /operator opens ticket and operator reply works", async () => {
  const { env, calls, tickets, links } = stub();
  let id = 400;
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    calls.push(JSON.parse(init.body));
    return Response.json({ ok: true, result: { message_id: id++ } });
  };
  try {
    const user = { update_id: 200, message: { chat: { id: 51, type: "private" }, from: { id: 51, language_code: "ru", first_name: "Test", username: "my_support_user" }, message_id: 55, text: "/operator" } };
    assert.equal((await call(env, user)).status, 200);
    assert.equal(tickets.size, 1);
    assert.equal(calls[0].chat_id, "-100234");
    assert.match(calls[0].text, /@my_support_user/);
    assert.match(calls[0].text, /<code>ru<\/code>/);
    assert.match(calls[0].text, /<code>\/close<\/code>/);
    assert.match(calls[0].text, /<blockquote>Оператор керак<\/blockquote>/);
    assert.doesNotMatch(calls[0].text, /Как ответить|Source:|Telegram:|ID:|Ticket #|Name:/);
    assert.equal(calls.length,2,"a newly opened ticket gets exactly one acknowledgement");
    assert.equal(calls[1].chat_id,51);
    assert.match(calls[1].text,/передано оператору/i);
    assert.equal(links.get(400), 1);
    const admin = { update_id: 201, message: { chat: { id: -100234, type: "supergroup" }, from: { id: 77 }, message_id: 999, text: "Уточните дату", reply_to_message: { message_id: 400 } } };
    assert.equal((await call(env, admin)).status, 200);
    assert.equal(calls.length,3,"operator reply is copied with no extra bot acknowledgement");
    assert.equal(calls[2].chat_id, 51);
    assert.equal(calls[2].from_chat_id, "-100234");
    assert.equal(calls[2].message_id, 999);
  } finally { globalThis.fetch = original; }
});


test("AI shows typing before model call and sends a brief answer", async () => {
  const { env } = stub();
  env.AI_API_KEY = "test-only-key";
  const calls = [];
  let typingCalls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("api.openai.com")) {
      assert.ok(typingCalls > 0, "Telegram typing indicator must precede AI generation");
      const body = JSON.parse(init.body);
      assert.equal(body.max_tokens, 160);
      assert.match(body.messages[0].content, /1 or 2 short sentences/);
      return Response.json({ choices: [{ message: { content: JSON.stringify({
        action: "answer",
        answer: "HSK AI помогает изучать китайский язык."
      }) } }] });
    }
    const method = String(url).split("/").pop();
    calls.push({ method, body: JSON.parse(init.body) });
    if (method === "sendChatAction") typingCalls++;
    return Response.json({ ok: true, result: { message_id: 800 } });
  };
  try {
    const user = {
      update_id: 300,
      message: { chat: { id: 71, type: "private" }, from: { id: 71, language_code: "ru" },
        message_id: 3, text: "Для чего нужен HSK AI?" }
    };
    assert.equal((await call(env, user)).status, 200);
    assert.equal(calls[0].method, "sendChatAction");
    assert.equal(calls[0].body.action, "typing");
    assert.equal(calls[0].body.chat_id, 71);
    assert.equal(calls.at(-1).method, "sendMessage");
    assert.equal(calls.at(-1).body.text, "HSK AI помогает изучать китайский язык.");
    assert.equal(calls.at(-1).body.chat_id, 71);
  } finally { globalThis.fetch = original; }
});


test("Cloudflare Workers AI binding answers briefly, without external AI API key", async () => {
  const { env } = stub();
  const calls = [];
  const aiCalls = [];
  env.AI_MODEL = "@cf/google/gemma-4-26b-a4b-it";
  env.AI = {
    async run(model, request) {
      aiCalls.push({ model, request });
      assert.ok(calls.some(x => x.method === "sendChatAction"), "typing indicator first");
      return { response: JSON.stringify({ action:"answer", answer:"HSK AI помогает учить китайский язык." }) };
    }
  };
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const method = String(url).split("/").pop();
    calls.push({ method, body: JSON.parse(init.body) });
    return Response.json({ ok:true, result:{ message_id:400 } });
  };
  try {
    const msg = {
      update_id: 301,
      message: {
        chat:{ id:72, type:"private" },
        from:{ id:72, language_code:"ru" },
        message_id:4,
        text:"Что такое HSK AI?"
      }
    };
    const response = await call(env, msg);
    assert.equal(response.status, 200);
    assert.equal(aiCalls.length, 1);
    assert.equal(aiCalls[0].model, "@cf/google/gemma-4-26b-a4b-it");
    assert.deepEqual(aiCalls[0].request.chat_template_kwargs, { enable_thinking: false });
    assert.match(aiCalls[0].request.messages[0].content, /Cyrillic script/);
    assert.ok(calls.some(x => x.method === "sendMessage" && x.body.text === "HSK AI помогает учить китайский язык."));
    assert.equal(calls.filter(x=>x.method==="sendMessage").length, 1);
  } finally { globalThis.fetch = original; }
});


test("Cron registers webhook once using secret without exposing it", async () => {
  const { env, settings } = stub();
  env.PUBLIC_WORKER_ORIGIN = "https://hsk-ai-support.hskaiiapp.workers.dev";
  const called = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const method = String(url).split("/").pop();
    const data = JSON.parse(init.body);
    called.push({ method, data });
    return Response.json({ ok:true, result:method==="getMe"?{username:"hskai_support_bot"}:true });
  };
  try {
    await worker.scheduled({cron:"*/5 * * * *"}, env);
    assert.equal(called.length, 2);
    assert.equal(called[0].method, "getMe");
    assert.equal(called[1].method, "setWebhook");
    assert.equal(called[1].data.secret_token, "secret");
    assert.equal(called[1].data.url, env.PUBLIC_WORKER_ORIGIN + "/webhook");
    assert.equal(settings.get("webhook_status").value, "registered");
    await worker.scheduled({cron:"*/5 * * * *"}, env);
    assert.equal(called.length, 2, "repeated cron must not call Telegram again");
    env.WEBHOOK_SECRET = "secret-rotated";
    settings.delete("webhook_last_attempt");
    await worker.scheduled({cron:"*/5 * * * *"}, env);
    assert.equal(called.length, 4, "rotating secret should register webhook again");
  } finally { globalThis.fetch = original; }
});


test("group administrator can discover own support group ID without external bots", async () => {
  const { env } = stub();
  delete env.ADMIN_CHAT_ID;
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const method = String(url).split("/").pop();
    const data = JSON.parse(init.body);
    calls.push({ method, data });
    return Response.json({
      ok: true,
      result: method === "getChatMember" ? { status: "administrator" } : { message_id: 950 }
    });
  };
  try {
    const update = { update_id: 401, message: {
      chat: { id: -100234, type: "supergroup" },
      from: { id: 98, is_bot: false },
      message_id: 940, text: "/chatid"
    } };
    assert.equal((await call(env, update)).status, 200);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].method, "getChatMember");
    assert.equal(calls[1].method, "sendMessage");
    assert.match(calls[1].data.text, /-100234/);
  } finally { globalThis.fetch = original; }
});


test("one-tap activate is idempotent and never returns token", async () => {
  const { env } = stub();
  env.PUBLIC_WORKER_ORIGIN = "https://hsk-ai-support.hskaiiapp.workers.dev";
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => Response.json({
    ok:true,
    result: String(url).endsWith("/getMe") ? { username:"hskai_support_bot" } :
      String(url).endsWith("/getWebhookInfo") ? {
        url:"https://hsk-ai-support.hskaiiapp.workers.dev/webhook",
        pending_update_count:0
      } : true
  });
  try {
    const req = new Request("https://support.example/activate");
    const result = await worker.fetch(req,env);
    assert.equal(result.status,200);
    const data = await result.json();
    assert.equal(data.status,"registered");
    assert.equal(data.credentials_visible,false);
    assert.ok(!JSON.stringify(data).includes("fake_token"));
    const repeat = await worker.fetch(req,env);
    assert.equal((await repeat.json()).status,"registered");
  } finally {
    globalThis.fetch = original;
  }
});


test("FAQ and AI work before operator group exists; handoff explains unavailability", async () => {
  const { env } = stub();
  delete env.ADMIN_CHAT_ID;
  env.AI = { run: async () => ({ choices: [{ message: { content: JSON.stringify({
    action: "answer", answer: "HSK AI помогает изучать китайский язык."
  }) } }] }) };
  env.AI_MODEL = "@cf/google/gemma-4-26b-a4b-it";
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const method = String(url).split("/").pop();
    calls.push({ method, data: JSON.parse(init.body) });
    return Response.json({ ok: true, result: { message_id: 901 } });
  };
  try {
    const message = (update_id, text) => ({
      update_id,
      message: { chat: { id: 99, type: "private" },
        from: { id: 99, language_code: "ru" }, message_id: update_id, text }
    });
    assert.equal((await call(env, message(701,"подписка"))).status,200);
    assert.match(calls.at(-1).data.text,/Оплата и подписка/);
    assert.equal((await call(env, message(702,"Что такое HSK AI?"))).status,200);
    assert.match(calls.at(-1).data.text,/HSK AI помогает/);
    assert.equal((await call(env, message(703,"/operator"))).status,200);
    assert.match(calls.at(-1).data.text,/Оператор пока недоступен/);
    assert.ok(!calls.some(c=>c.data.chat_id===undefined && c.method==="sendMessage"));
  } finally { globalThis.fetch = original; }
});

test("ticket with no Telegram username retains user ID and safe fallback", async () => {
  const { env } = stub();
  const calls = [];
  const previous = globalThis.fetch;
  let n = 900;
  globalThis.fetch = async (_url, init) => {
    calls.push(JSON.parse(init.body));
    return Response.json({ ok:true, result:{ message_id:n++ } });
  };
  try {
    const update = { update_id: 703, message: {
      chat: { id: 108, type: "private" },
      from: { id: 108, language_code: "ru", first_name: "User" },
      message_id: 11, text: "/operator"
    }};
    assert.equal((await call(env, update)).status, 200);
    assert.match(calls[0].text, /<b>User<\/b>/);
    assert.match(calls[0].text, /tg:\/\/user\?id=108/);
    assert.match(calls[0].text, /<blockquote>Оператор керак<\/blockquote>/);
    assert.doesNotMatch(calls[0].text, /ID:|Telegram:|Source:|Name:/);
    assert.equal(calls.length,2);
    assert.match(calls[1].text,/передано оператору/i);
  } finally { globalThis.fetch = previous; }
});


test("V2 image screenshot is sent to Vision with R2 facts, not saved in knowledge", async () => {
  const {env}=stub();
  const baseSha="c8c1aaf5b2b07b40878017ae8f6bb7a60da4b073";
  const objects=[];
  env.KB={get:async key=>{
    objects.push(key);
    return {json:async()=>({topic:"general",source_commit:baseSha,facts:["HSK AI teaches Chinese."]})};
  }};
  const aiRequests=[];
  env.AI={run:async(model,request)=>{
    aiRequests.push({model,request});
    return {response:JSON.stringify({action:"answer",answer:"Проверьте настройки приложения."})};
  }};
  const calls=[];
  const original=globalThis.fetch;
  globalThis.fetch=async(url,init)=>{
    const method=String(url).split("/").pop();
    if(method==="getFile")return Response.json({ok:true,result:{file_path:"photos/test.jpg",file_size:6}});
    if(String(url).includes("/file/bot")){
      return new Response(Uint8Array.from([255,216,255,1,2,3]),{headers:{"content-type":"image/jpeg"}});
    }
    calls.push({method,body:JSON.parse(init.body)});
    return Response.json({ok:true,result:{message_id:121}});
  };
  try{
    const update={update_id:9901,message:{chat:{id:991,type:"private"},
      from:{id:991,language_code:"ru"},message_id:9901,
      photo:[{file_id:"f1",file_size:6}]}};
    assert.equal((await call(env,update)).status,200);
    assert.deepEqual(objects,["knowledge/general.json"]);
    assert.equal(aiRequests.length,1);
    assert.ok(aiRequests[0].request.messages.at(-1).content.some(part => part.type==="image_url" && part.image_url.url.startsWith("data:image/jpeg;base64,")));
    assert.match(aiRequests[0].request.messages[0].content,/HSK AI teaches Chinese/);
    assert.ok(calls.some(c=>c.method==="sendMessage"&&c.body.text==="Проверьте настройки приложения."));
    assert.ok(!calls.some(c=>c.method==="copyMessage"));
  } finally {globalThis.fetch=original;}
});

test("V2 fails closed when R2 topic is missing; no AI hallucination",async()=>{
  const {env,quotas}=stub();const calls=[];
  let aiCalls=0;
  env.KB={get:async()=>null};
  env.AI={run:async()=>{aiCalls++;return {response:"{}"}}};
  const orig=globalThis.fetch;
  globalThis.fetch=async(url,init)=>{
    calls.push({method:String(url).split("/").pop(),data:JSON.parse(init.body)});
    return Response.json({ok:true,result:{message_id:calls.length+500}});
  };
  try{
    const update={update_id:9902,message:{chat:{id:992,type:"private"},from:{id:992,language_code:"ru"},
      message_id:9902,text:"Не могу войти в аккаунт"}};
    assert.equal((await call(env,update)).status,200);
    assert.equal(aiCalls,0);
    assert.equal(quotas.size,1,"only the user message rate limit is charged, not AI quota");
    assert.ok(!calls.some(x=>x.data.chat_id==="-100234"));
    assert.ok(calls.some(x=>x.method==="sendMessage"&&x.data.chat_id===992&&/\/operator/.test(x.data.text)));
  }finally{globalThis.fetch=orig;}
});

test("V2 technical primary failure attempts configured MiniMax and then answers",async()=>{
  const {env,quotas}=stub();
  const sha="c8c1aaf5b2b07b40878017ae8f6bb7a60da4b073";
  env.KB={get:async()=>({json:async()=>({topic:"general",source_commit:sha,facts:["Chinese lessons are available."]})})};
  env.BACKUP_ENABLED="true";
  env.BACKUP_BILLING_APPROVED="true"; // simulated approval in mock only
  env.BACKUP_SPEND_CAP_VERIFIED="true"; // mocked: live spend cap not enabled
  env.AI_GATEWAY_ID="hsk-ai-support";
  let calls=0;
  env.AI={run:async(model,request,options)=>{
    calls++;
    if(model.startsWith("@cf/")) throw new Error("exhausted");
    assert.equal(model,"minimax/m3.1-flash");
    assert.equal(options.gateway.id,"hsk-ai-support");
    return {choices:[{message:{content:JSON.stringify({action:"answer",answer:"Откройте раздел курса."})}}]};
  }};
  const tg=[];
  const orig=globalThis.fetch;
  globalThis.fetch=async(url,init)=>{
    tg.push({method:String(url).split("/").pop(),data:JSON.parse(init.body)});
    return Response.json({ok:true,result:{message_id:1001}});
  };
  try{
    const update={update_id:9903,message:{chat:{id:993,type:"private"},from:{id:993,language_code:"ru"},
      message_id:9903,text:"Что такое HSK AI?"}};
    assert.equal((await call(env,update)).status,200);
    assert.equal(calls,2);
    assert.equal(quotas.get("backup-month:"+new Date().toISOString().slice(0,7)),1);
    assert.ok(tg.some(x=>x.data.text==="Откройте раздел курса."));
  }finally{globalThis.fetch=orig;}
});

test("V2 payment proof image never reaches AI or human without consent",async()=>{
  const {env}=stub();
  let aiCalls=0;
  env.AI={run:async()=>{aiCalls++;return {response:"{}"}}};
  const tg=[];
  const orig=globalThis.fetch;
  let nextId=1500;
  globalThis.fetch=async(url,init)=>{
    const method=String(url).split("/").pop();
    tg.push({method,data:JSON.parse(init.body)});
    return Response.json({ok:true,result:{message_id:nextId++}});
  };
  try{
    const update={update_id:9904,message:{chat:{id:994,type:"private"},from:{id:994,language_code:"ru"},
      message_id:9904,caption:"Вот чек оплаты",photo:[{file_id:"photo",file_size:100}]}};
    assert.equal((await call(env,update)).status,200);
    assert.equal(aiCalls,0);
    assert.ok(!tg.some(x=>x.method==="copyMessage"));
    assert.ok(tg.some(x=>x.method==="sendMessage"&&x.data.chat_id===994&&/\/operator/.test(x.data.text)));
  }finally{globalThis.fetch=orig;}
});


test("V2 refuses clearly Uzbek text when Tajik reply was required",async()=>{
  const {env,tickets}=stub();
  const sha="c8c1aaf5b2b07b40878017ae8f6bb7a60da4b073";
  env.KB={get:async()=>({json:async()=>({topic:"general",source_commit:sha,facts:["HSK AI helps learn Chinese."]})})};
  env.AI={run:async(model,payload)=>{
    assert.match(payload.messages[0].content,/MANDATORY REPLY LANGUAGE: Tajik/);
    return {response:JSON.stringify({action:"answer",answer:"HSK AI — бу хитой тилини ўрганиш иловаси."})};
  }};
  const calls=[];
  const original=globalThis.fetch;
  globalThis.fetch=async(url,init)=>{
    calls.push({method:String(url).split("/").pop(),data:JSON.parse(init.body)});
    return Response.json({ok:true,result:{message_id:1002+calls.length}});
  };
  try{
    const update={update_id:9910,message:{chat:{id:9910,type:"private"},from:{id:9910,language_code:"ru"},message_id:10,text:"HSK AI чист?"}};
    assert.equal((await call(env,update)).status,200);
    assert.equal(tickets.size,0,"wrong language must not open ticket without consent");
    assert.ok(calls.some(c=>c.method==="sendMessage"&&/\/operator/.test(c.data.text)));
    assert.ok(!calls.some(c=>c.method==="sendMessage" && /хитой тилини ўрганиш/.test(c.data.text)));
  }finally{globalThis.fetch=original;}
});


test("V2 paid MiniMax cannot run without separate approval and a verified Gateway route",async()=>{
  const {env,tickets}=stub();
  env.AI_MODEL="@cf/google/gemma-4-26b-a4b-it";
  const sha="c8c1aaf5b2b07b40878017ae8f6bb7a60da4b073";
  env.KB={get:async()=>({json:async()=>({topic:"general",source_commit:sha,facts:["Chinese lessons are available."]})})};
  env.BACKUP_ENABLED="true";
  let attempts=[];
  env.AI={run:async(model)=>{
    attempts.push(model);
    throw new Error("primary quota exceeded");
  }};
  const original=globalThis.fetch;
  globalThis.fetch=async(url,init)=>Response.json({ok:true,result:{message_id:1800}});
  try{
    const update={update_id:9920,message:{chat:{id:9920,type:"private"},from:{id:9920,language_code:"ru"},message_id:20,text:"Что такое HSK AI?"}};
    assert.equal((await call(env,update)).status,200);
    assert.deepEqual(attempts,["@cf/google/gemma-4-26b-a4b-it"],"never call paid provider without explicit billing approval");
    assert.equal(tickets.size,0);
  }finally{globalThis.fetch=original;}
});


test("V2 blocks internal PWA config and personal payment status",async()=>{
  const {env,tickets}=stub();
  const sha="c8c1aaf5b2b07b40878017ae8f6bb7a60da4b073";
  env.KB={get:async key=>({json:async()=>({topic:key.slice(10,-5),source_commit:sha,facts:["PWA_AUTH_ENABLED controls PWA sign in."]})})};
  let aiCalls=0;
  env.AI={run:async()=>{
    aiCalls++;
    return {response:JSON.stringify({action:"answer",answer:"Вход зависит от PWA_AUTH_ENABLED."})};
  }};
  const telegramCalls=[];
  const original=globalThis.fetch;
  globalThis.fetch=async(url,init)=>{
    telegramCalls.push({method:String(url).split("/").pop(),data:JSON.parse(init.body)});
    return Response.json({ok:true,result:{message_id:2000+telegramCalls.length}});
  };
  try{
    const unsafe={update_id:9980,message:{chat:{id:9980,type:"private"},from:{id:9980,language_code:"ru"},message_id:80,text:"PWA авторизация сейчас активна?"}};
    assert.equal((await call(env,unsafe)).status,200);
    assert.equal(aiCalls,1);
    assert.equal(tickets.size,0);
    assert.ok(!telegramCalls.some(x=>x.method==="sendMessage"&&String(x.data.text).includes("PWA_AUTH_ENABLED")));
    const payment={update_id:9981,message:{chat:{id:9981,type:"private"},from:{id:9981,language_code:"uz"},message_id:81,text:"Менинг тўлов чеким тасдиқланганми?"}};
    assert.equal((await call(env,payment)).status,200);
    assert.equal(aiCalls,1,"personal payment status must not reach AI");
    assert.equal(tickets.size,0);
    assert.ok(telegramCalls.every(x=>x.data.chat_id!=="-100234"));
  }finally{globalThis.fetch=original;}
});


test("V2 missing R2 binding fails closed instead of using stale local FACTS",async()=>{
  const {env,tickets}=stub();
  delete env.KB;
  let aiCalls=0;
  env.AI={run:async()=>{aiCalls++;return {response:"{}"}}};
  const orig=globalThis.fetch;
  globalThis.fetch=async()=>Response.json({ok:true,result:{message_id:3000}});
  try{
    const u={update_id:9990,message:{chat:{id:9990,type:"private"},from:{id:9990,language_code:"ru"},message_id:90,text:"Что такое HSK AI?"}};
    assert.equal((await call(env,u)).status,200);
    assert.equal(aiCalls,0);
    assert.equal(tickets.size,0);
  }finally{globalThis.fetch=orig;}
});


test("operator chat is explicitly opened, follows up silently and closes on admin /close", async () => {
  const {env,tickets,links}=stub();
  let nextId=500;
  const calls=[];
  const original=globalThis.fetch;
  globalThis.fetch=async (url,init)=>{
    calls.push({method:String(url).split("/").pop(),data:JSON.parse(init.body)});
    return Response.json({ok:true,result:{message_id:nextId++}});
  };
  try {
    const from={id:601,language_code:"ru",first_name:"Client",username:"clientname"};
    const userMessage=(update_id,message_id,field,value)=>({
      update_id,message:{chat:{id:601,type:"private"},from,message_id,[field]:value}
    });
    assert.equal((await call(env,userMessage(600,90,"text","/operator"))).status,200);
    assert.equal(tickets.size,1);
    assert.equal(calls.length,2);
    assert.equal(calls[0].method,"sendMessage");
    assert.equal(calls[0].data.parse_mode,"HTML");
    assert.match(calls[0].data.text,/<blockquote>Оператор керак<\/blockquote>/);
    assert.equal(links.get(500),1);
    assert.equal(calls[1].data.chat_id,601);
    assert.match(calls[1].data.text,/передано оператору/i);
    assert.equal((await call(env,userMessage(601,91,"text","Приложение <не работает>"))).status,200);
    assert.equal(calls.length,3,"ongoing chat has no automatic message to user");
    assert.equal(calls[2].method,"copyMessage");
    assert.equal(calls[2].data.chat_id,"-100234");
    assert.equal(calls[2].data.message_id,91);
    assert.equal(links.get(502),1);
    const photo={update_id:602,message:{chat:{id:601,type:"private"},from,message_id:93,caption:"Новый экран",photo:[{file_id:"test",file_size:100}]}};
    assert.equal((await call(env,photo)).status,200);
    assert.equal(calls.length,4);
    assert.equal(calls[3].method,"copyMessage");
    assert.equal(calls[3].data.message_id,93);
    assert.equal(links.get(503),1);
    const admin={update_id:603,message:{chat:{id:-100234,type:"supergroup"},from:{id:87},message_id:1001,
      text:"Проверьте версию",reply_to_message:{message_id:502}}};
    assert.equal((await call(env,admin)).status,200);
    assert.equal(calls.length,5);
    assert.equal(calls[4].method,"copyMessage");
    assert.equal(calls[4].data.chat_id,601);
    const close={update_id:604,message:{chat:{id:-100234,type:"supergroup"},from:{id:87},message_id:1002,
      text:"/close",reply_to_message:{message_id:503}}};
    assert.equal((await call(env,close)).status,200);
    assert.equal(tickets.get(1).status,"closed");
    assert.equal(calls.length,7,"closing sends one status to user and one to admin");
    assert.equal(calls[5].data.chat_id,601);
    assert.match(calls[5].data.text,/закрыл обращение/i);
    assert.equal(calls[6].data.chat_id,"-100234");
  } finally { globalThis.fetch=original; }
});


test("buttons render only on /start, never on FAQ, topic callback, AI, or safe fallback", async () => {
  const {env,tickets}=stub();
  env.AI_MODEL="@cf/google/gemma-4-26b-a4b-it";
  env.AI={run:async()=>({response:JSON.stringify({action:"answer",answer:"HSK AI помогает изучать китайский язык."})})};
  const calls=[];
  const original=globalThis.fetch;
  let next=101;
  globalThis.fetch=async(url,init)=>{
    calls.push({method:String(url).split("/").pop(),payload:JSON.parse(init.body)});
    return Response.json({ok:true,result:{message_id:next++}});
  };
  const user={id:812,language_code:"ru",username:"test_support"};
  const send=async(id,text)=>call(env,{update_id:id,message:{chat:{id:812,type:"private"},from:user,message_id:id,text}});
  try{
    assert.equal((await send(8100,"/start")).status,200);
    assert.equal(calls.filter(c=>c.method==="sendMessage").length,1);
    assert.equal(calls[0].payload.reply_markup.inline_keyboard.length,2);
    assert.equal((await call(env,{update_id:8101,callback_query:{
      id:"callback8101",from:user,message:{message_id:101,chat:{id:812,type:"private"}},data:"help:payment"
    }})).status,200);
    assert.equal((await send(8102,"подписка")).status,200);
    assert.equal((await send(8103,"Что такое HSK AI?")).status,200);
    assert.equal((await send(8104,"qwertyqwerty нет такого раздела")).status,200);
    assert.equal((await send(8105,"Мой чек подтверждает оплату?")).status,200);
    assert.equal((await send(8106,"/help")).status,200);
    const userMessages=calls.filter(c=>c.method==="sendMessage"&&c.payload.chat_id===812);
    assert.equal(userMessages.length,7);
    assert.ok(userMessages[0].payload.reply_markup);
    for(const item of userMessages.slice(1)){
      assert.equal(item.payload.reply_markup,undefined,"only /start may include menu buttons");
    }
    assert.ok(userMessages.some(c=>/\/operator/.test(c.payload.text)));
    assert.equal(tickets.size,0,"FAQ/AI/fallback/personal payment must not create tickets");
    assert.ok(!calls.some(c=>c.method==="sendMessage"&&c.payload.chat_id==="-100234"));
  } finally {globalThis.fetch=original;}
});

test("repeated unknown messages never auto-open tickets; only /operator opens one",async()=>{
  const {env,tickets}=stub();
  const calls=[];
  const original=globalThis.fetch; let next=600;
  globalThis.fetch=async(url,init)=>{
    calls.push({method:String(url).split("/").pop(),payload:JSON.parse(init.body)});
    return Response.json({ok:true,result:{message_id:next++}});
  };
  const from={id:813,language_code:"ru",username:"supportuser"};
  const send=async(id,text)=>call(env,{update_id:id,message:{chat:{id:813,type:"private"},from,message_id:id,text}});
  try{
    for(let i=0;i<3;i++){
      assert.equal((await send(8200+i,"qwerty-unknown-"+i)).status,200);
      assert.equal(tickets.size,0);
    }
    assert.equal(calls.filter(c=>c.method==="sendMessage"&&c.payload.chat_id===813).length,3);
    assert.equal((await send(8203,"/operator")).status,200);
    assert.equal(tickets.size,1);
    assert.equal(calls.filter(c=>c.method==="sendMessage"&&c.payload.chat_id==="-100234").length,1);
    assert.equal((await send(8204,"Еще один вопрос")).status,200);
    assert.ok(calls.some(c=>c.method==="copyMessage"&&c.payload.message_id===8204));
    assert.equal(calls.filter(c=>c.method==="sendMessage"&&c.payload.chat_id===813).length,4,
      "only one opening notice, no active conversation delivery acknowledgement");
  }finally{globalThis.fetch=original;}
});

test("/start returns from open operator ticket to AI and restores one menu",async()=>{
  const {env,tickets}=stub();
  env.AI={run:async()=>({response:JSON.stringify({action:"answer",answer:"HSK AI помогает изучать китайский язык."})})};
  const calls=[];
  const original=globalThis.fetch;let next=1500;
  globalThis.fetch=async(url,init)=>{
    calls.push({method:String(url).split("/").pop(),data:JSON.parse(init.body)});
    return Response.json({ok:true,result:{message_id:next++}});
  };
  const from={id:814,language_code:"ru",username:"returnuser"};
  const send=async(id,text)=>call(env,{update_id:id,message:{chat:{id:814,type:"private"},from,message_id:id,text}});
  try{
    assert.equal((await send(8300,"/operator")).status,200);
    assert.equal(tickets.get(1).status,"open");
    const before=calls.length;
    assert.equal((await send(8301,"/start")).status,200);
    assert.equal(tickets.get(1).status,"closed");
    assert.equal(calls.length,before+2,"admin is informed once; user gets one menu");
    assert.match(calls.at(-1).data.text,/Здравствуйте/);
    assert.ok(calls.at(-1).data.reply_markup?.inline_keyboard);
    const last=calls.length;
    assert.equal((await send(8302,"Что такое HSK AI?")).status,200);
    assert.ok(calls.slice(last).some(x=>x.method==="sendMessage"&&x.data.chat_id===814&&/помогает/.test(x.data.text)));
    assert.ok(!calls.slice(last).some(x=>x.method==="copyMessage"&&x.data.chat_id==="-100234"));
  }finally{globalThis.fetch=original;}
});


test("Uzbek language request works without a picker, R2 facts or auto-operator",async()=>{
  const {env,users,tickets}=stub();
  let kbReads=0;
  env.KB={get:async()=>{kbReads++;throw Error("R2 unavailable");}};
  const aiPrompts=[];
  env.AI={run:async(_model,request)=>{
    aiPrompts.push(request.messages[0].content);
    return {response:JSON.stringify({
      action:"answer",answer:"Албатта! Ўзбек тилида суҳбатлашамиз. HSK AI бўйича қандай ёрдам керак?"
    })};
  }};
  const messages=[];
  const original=globalThis.fetch;
  globalThis.fetch=async(url,init)=>{
    const method=String(url).split("/").pop();
    if(method==="sendMessage") messages.push(JSON.parse(init.body));
    return Response.json({ok:true,result:{message_id:2000+messages.length}});
  };
  const from={id:901,language_code:"ru"};
  const send=(update_id,text)=>call(env,{update_id,message:{
    chat:{id:901,type:"private"},from,message_id:update_id,text
  }});
  try{
    assert.equal((await send(9100,"/start ru_android")).status,200);
    assert.equal(users.get(901).lang,"ru");
    assert.equal((await send(9101,"салом ўзбек тилида суҳбатлаша оламизми?")).status,200);
    assert.equal(users.get(901).lang,"uz");
    assert.match(aiPrompts[0],/MANDATORY REPLY LANGUAGE: Uzbek/);
    assert.equal(kbReads,0,"a language request should not require R2");
    assert.match(messages.at(-1).text,/Ўзбек тилида/);
    assert.equal((await send(9102,"ээээ")).status,200);
    assert.equal(users.get(901).lang,"uz","ambiguous messages must retain preferred language");
    assert.equal(messages[0].reply_markup?.inline_keyboard?.length,2);
    assert.ok(messages.slice(1).every(m=>!m.reply_markup),"menu appears only on /start");
    assert.equal(tickets.size,0,"social turns cannot open operator tickets");
  }finally{globalThis.fetch=original;}
});

test("AI outage keeps Uzbek greeting natural without a product-KB fallback loop",async()=>{
  const {env,users,tickets}=stub();
  let kbReads=0;
  env.KB={get:async()=>{kbReads++;return null;}};
  const messages=[];
  const original=globalThis.fetch;
  globalThis.fetch=async(url,init)=>{
    if(String(url).endsWith("/sendMessage")) messages.push(JSON.parse(init.body));
    return Response.json({ok:true,result:{message_id:1}});
  };
  const from={id:902,language_code:"ru"};
  try{
    const update={update_id:9200,message:{chat:{id:902,type:"private"},from,
      message_id:9200,text:"салом ўзбек тилида суҳбатлаша оламизми?"}};
    assert.equal((await call(env,update)).status,200);
    assert.equal(users.get(902).lang,"uz");
    assert.match(messages.at(-1).text,/Ўзбек тилида/);
    assert.doesNotMatch(messages.at(-1).text,/Уточните|\/operator/);
    assert.equal(kbReads,0);
    assert.equal(tickets.size,0);
  }finally{globalThis.fetch=original;}
});


test("account menu then Android preserves sign-in context and offers localized official FAQ",async()=>{
  const {env,conversations,quotas}=stub();
  let modelCalls=0;
  env.AI={run:async()=>{modelCalls++;return {response:'{"action":"answer","answer":"Скачайте приложение."}'}}};
  const previous=globalThis.fetch;
  const calls=[];let id=4501;
  globalThis.fetch=async(url,init)=>{
    calls.push({method:String(url).split("/").pop(),payload:JSON.parse(init.body)});
    return Response.json({ok:true,result:{message_id:id++}});
  };
  const user={id:4500,language_code:"ru",username:"faq_user"};
  try {
    const begin={update_id:4500,message:{chat:{id:4500,type:"private"},from:user,message_id:1,text:"/start"}};
    assert.equal((await call(env,begin)).status,200);
    const pick={update_id:4501,callback_query:{id:"q4501",from:user,message:{message_id:4501,chat:{id:4500,type:"private"}},data:"help:account"}};
    assert.equal((await call(env,pick)).status,200);
    assert.equal(conversations.length,2);
    const follow={update_id:4502,message:{chat:{id:4500,type:"private"},from:user,message_id:2,text:"андроид"}};
    assert.equal((await call(env,follow)).status,200);
    assert.equal(modelCalls,0,"platform clarification must not waste AI call");
    const last=calls.filter(x=>x.method==="sendMessage").at(-1).payload;
    assert.match(last.text,/Проблема со входом/);
    assert.match(last.text,/https:\/\/hskai\.app\/ru\/guide\/faq\//);
    assert.doesNotMatch(last.text,/скача|загруз/ui);
    assert.equal(last.reply_markup,undefined);
    assert.equal(quotas.has("ai-user:4500:"+new Date().toISOString().slice(0,10)),false);
  } finally {globalThis.fetch=previous;}
});

test("Android download and Instagram questions return only verified clickable links",async()=>{
  const {env}=stub();
  env.AI={run:async()=>({response:JSON.stringify({action:"answer",answer:"Ссылку можно открыть на официальном сайте."})})};
  const previous=globalThis.fetch;const calls=[];let id=4600;
  globalThis.fetch=async(url,init)=>{
    calls.push({method:String(url).split("/").pop(),payload:JSON.parse(init.body)});
    return Response.json({ok:true,result:{message_id:id++}});
  };
  const from={id:4600,language_code:"ru"};
  const send=(update_id,text)=>call(env,{update_id,message:{chat:{id:4600,type:"private"},from,message_id:update_id,text}});
  try{
    assert.equal((await send(4601,"Где скачать Android приложение?")).status,200);
    assert.equal((await send(4602,"Инстаграм HSK AI")).status,200);
    const msgs=calls.filter(x=>x.method==="sendMessage").map(x=>x.payload.text);
    assert.equal(msgs.length,2);
    assert.match(msgs[0],/https:\/\/hskai\.app\/download/);
    assert.match(msgs[1],/https:\/\/www\.instagram\.com\/hskai\.app/);
    assert.ok(!msgs.some(x=>x.includes("fake-hskai")));
  }finally{globalThis.fetch=previous;}
});


test("new /start or different FAQ topic clears stale account-only follow-up",async()=>{
  const {env,conversations}=stub();
  let aiCalls=0;
  env.AI={run:async()=>{aiCalls++;return {response:JSON.stringify({action:"answer",answer:"Общая информация по Android."})}}};
  const old=globalThis.fetch;
  let number=6100;
  globalThis.fetch=async()=>Response.json({ok:true,result:{message_id:number++}});
  const from={id:6161,language_code:"ru"};
  const start=(u)=>call(env,{update_id:u,message:{chat:{id:6161,type:"private"},from,message_id:u,text:"/start"}});
  const reply=(u,text)=>call(env,{update_id:u,message:{chat:{id:6161,type:"private"},from,message_id:u,text}});
  const option=(u,data)=>call(env,{update_id:u,callback_query:{id:"q"+u,from,message:{chat:{id:6161,type:"private"},message_id:u},data}});
  try{
    assert.equal((await start(6161)).status,200);
    assert.equal((await option(6162,"help:account")).status,200);
    assert.equal(conversations.length,2);
    assert.equal((await start(6163)).status,200);
    assert.equal(conversations.length,0);
    assert.equal((await reply(6164,"андроид")).status,200);
    assert.equal(aiCalls,1,"fresh start must not reuse old account follow-up");
    assert.equal((await option(6165,"help:account")).status,200);
    assert.equal(conversations.length>=2,true);
    assert.equal((await option(6166,"help:payment")).status,200);
    assert.equal(conversations.length,0,"switching FAQ topic clears former account context");
  }finally{globalThis.fetch=old;}
});

test("photo with Russian interface criticism reaches vision instead of file-error reply",async()=>{
  const {env,tickets}=stub();
  const topics=[],modelCalls=[],messages=[];
  const sha="c8c1aaf5b2b07b40878017ae8f6bb7a60da4b073";
  env.KB={get:async key=>{
    topics.push(key);
    return {json:async()=>({topic:"general",source_commit:sha,facts:["HSK AI is a Chinese learning product."]})};
  }};
  env.AI={run:async(_model,request)=>{
    modelCalls.push(request);
    return {response:JSON.stringify({action:"answer",answer:"На фото экран тарифов: текст выглядит мелким. Что именно неудобно — размер шрифта или расположение блоков?"})};
  }};
  const original=globalThis.fetch;
  globalThis.fetch=async(url,init)=>{
    if(String(url).endsWith("/getFile"))return Response.json({ok:true,result:{file_path:"photos/ui.jpg",file_size:6}});
    if(String(url).includes("/file/bot"))return new Response(Uint8Array.from([255,216,255,1,2,3]));
    const method=String(url).split("/").pop();
    if(method==="sendMessage")messages.push(JSON.parse(init.body));
    return Response.json({ok:true,result:{message_id:321}});
  };
  try {
    const m={update_id:29901,message:{chat:{id:299,type:"private"},from:{id:299,language_code:"ru"},
      message_id:29901,caption:"интерфейс не очень хороший",photo:[{file_id:"u1",file_size:6}]}};
    assert.equal((await call(env,m)).status,200);
    assert.deepEqual(topics,["knowledge/general.json"]);
    assert.equal(modelCalls.length,1);
    assert.equal(modelCalls[0].max_tokens,320,"photos need enough output tokens for JSON");
    assert.ok(modelCalls[0].messages.at(-1).content.some(p=>p.type==="image_url"));
    assert.match(messages.at(-1).text,/экран тарифов/);
    assert.doesNotMatch(messages.at(-1).text,/Не удалось обработать файл/);
    assert.equal(tickets.size,0);
  } finally {globalThis.fetch=original;}
});

test("valid image with failed AI receives useful feedback acknowledgment, not a false file failure",async()=>{
  const {env,tickets}=stub();
  env.AI={run:async()=>({response:'{"action":"handoff","answer":""}'})};
  const sent=[];let copyMessages=0;
  const original=globalThis.fetch;
  globalThis.fetch=async(url,init)=>{
    if(String(url).endsWith("/getFile"))return Response.json({ok:true,result:{file_path:"photos/ui.jpg",file_size:6}});
    if(String(url).includes("/file/bot"))return new Response(Uint8Array.from([255,216,255,1,2,3]));
    const method=String(url).split("/").pop();
    if(method==="sendMessage")sent.push(JSON.parse(init.body));
    if(method==="copyMessage")copyMessages++;
    return Response.json({ok:true,result:{message_id:422}});
  };
  try{
    const m={update_id:29902,message:{chat:{id:300,type:"private"},from:{id:300,language_code:"ru"},
      message_id:29902,caption:"интерфейс не очень хороший",photo:[{file_id:"u1",file_size:6}]}};
    assert.equal((await call(env,m)).status,200);
    assert.match(sent.at(-1).text,/Спасибо за отзыв об интерфейсе/);
    assert.doesNotMatch(sent.at(-1).text,/Не удалось загрузить изображение/);
    assert.equal(copyMessages,0);
    assert.equal(tickets.size,0);
  }finally{globalThis.fetch=original;}
});

test("failed Telegram photo download is reported separately from AI uncertainty",async()=>{
  const {env,tickets}=stub();
  const sent=[];let modelCalls=0;
  env.AI={run:async()=>{modelCalls++;return {response:"{}"};}};
  const original=globalThis.fetch;
  globalThis.fetch=async(url,init)=>{
    if(String(url).endsWith("/getFile"))return Response.json({ok:true,result:{file_path:"photos/ui.jpg",file_size:6}});
    if(String(url).includes("/file/bot"))return new Response("error",{status:503});
    const method=String(url).split("/").pop();
    if(method==="sendMessage")sent.push(JSON.parse(init.body));
    return Response.json({ok:true,result:{message_id:523}});
  };
  try{
    const m={update_id:29903,message:{chat:{id:301,type:"private"},from:{id:301,language_code:"ru"},
      message_id:29903,caption:"интерфейс не очень хороший",photo:[{file_id:"u1",file_size:6}]}};
    assert.equal((await call(env,m)).status,200);
    assert.match(sent.at(-1).text,/Не удалось загрузить изображение/);
    assert.equal(modelCalls,0);
    assert.equal(tickets.size,0);
  }finally{globalThis.fetch=original;}
});


test("official support links stay clickable without Telegram preview cards", async () => {
  const {env}=stub();
  const oldFetch=globalThis.fetch, calls=[];
  let id=9001;
  globalThis.fetch=async(url,init)=>{
    calls.push({method:String(url).split("/").pop(),params:JSON.parse(init.body)});
    return Response.json({ok:true,result:{message_id:id++}});
  };
  const user={id:9000,language_code:"ru"};
  try{
    const start={update_id:9000,message:{chat:{id:9000,type:"private"},from:user,message_id:1,text:"/start"}};
    const callback={update_id:9001,callback_query:{id:"qa-9001",from:user,
      message:{chat:{id:9000,type:"private"},message_id:9001},data:"help:account"}};
    const android={update_id:9002,message:{chat:{id:9000,type:"private"},from:user,message_id:2,text:"андроид"}};
    assert.equal((await call(env,start)).status,200);
    assert.equal((await call(env,callback)).status,200);
    assert.equal((await call(env,android)).status,200);
    const userMessages=calls.filter(c=>c.method==="sendMessage"&&c.params.chat_id===9000);
    assert.equal(userMessages.length,3);
    assert.ok(userMessages.every(m=>m.params.link_preview_options?.is_disabled===true));
    assert.match(userMessages[2].params.text,/https:\/\/hskai\.app\/ru\/guide\/faq\//);
    assert.ok(userMessages[0].params.reply_markup,"/start keeps buttons");
    assert.equal(userMessages[2].params.reply_markup,undefined,"follow-up stays button-free");
  } finally {globalThis.fetch=oldFetch;}
});
