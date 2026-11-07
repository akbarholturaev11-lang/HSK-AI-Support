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
      if (sql.startsWith("UPDATE tickets SET source=")) {
        const t=tickets.get(args[2]);
        if(t && t.source==="ai_report"){t.source=args[0];return {meta:{changes:1}};}
        return {meta:{changes:0}};
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
      assert.equal(body.max_tokens, 450);
      assert.deepEqual(body.response_format,{type:"json_object"});
      assert.equal(body.temperature,0.2);
      assert.match(body.messages[0].content, /Read the recent dialogue/);
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
    assert.deepEqual(aiCalls[0].request.response_format,{type:"json_object"});
    assert.equal(aiCalls[0].request.temperature,0.2);
    assert.match(aiCalls[0].request.messages[0].content, /Reply naturally and briefly in Russian/);
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
    assert.equal(quotas.size,0,"no per-user message or AI quota is charged");
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
    assert.match(payload.messages[0].content,/Reply naturally and briefly in Tajik/);
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
    assert.equal(userMessages.length,6);
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
    assert.match(aiPrompts[0],/Reply naturally and briefly in Uzbek/);
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
  env.AI={run:async(_model,request)=>{modelCalls++;assert.ok(request.messages.some(m=>String(m.content).includes("FAQ selected: account")));return {response:JSON.stringify({action:"answer",answer:"Проверьте способ входа на Android: Google или Telegram?"})}}};
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
    assert.equal(modelCalls,1,"AI receives FAQ context rather than a one-off template");
    const last=calls.filter(x=>x.method==="sendMessage").at(-1).payload;
    assert.match(last.text,/входа|вход/i);
    assert.doesNotMatch(last.text,/скача|загруз/ui);
    assert.equal(last.reply_markup,undefined);
    assert.equal([...quotas.keys()].some(key=>/^(?:ai-user:|ai-global:|msg-user:)/.test(key)),false);
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
    assert.equal(conversations.length,2,"new start is stored for AI");
    assert.equal((await reply(6164,"андроид")).status,200);
    assert.equal(aiCalls,1,"fresh start must not reuse old account follow-up");
    assert.equal((await option(6165,"help:account")).status,200);
    assert.equal(conversations.length>=2,true);
    assert.equal((await option(6166,"help:payment")).status,200);
    assert.equal(conversations.length,2,"new payment FAQ replaces account context");
    assert.match(conversations[0].text,/FAQ selected: payment/);
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
    assert.equal(modelCalls[0].max_tokens,540,"photos get enough output tokens for JSON");
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
  env.AI={run:async()=>({response:JSON.stringify({action:"answer",answer:"Помощь со входом на Android: что именно не работает?"})})};
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
    assert.equal(userMessages.length,2,"FAQ selection adds context but no chat bubble");
    assert.ok(userMessages.every(m=>m.params.link_preview_options?.is_disabled===true));
    assert.match(userMessages[1].params.text,/помощь|поддержка/i);
    assert.ok(userMessages[0].params.reply_markup,"/start keeps buttons");
    assert.equal(userMessages[1].params.reply_markup,undefined,"follow-up stays button-free");
  } finally {globalThis.fetch=oldFetch;}
});


test("Uzbek guide, iPhone link and resend requests are answered without repetitive fallback", async()=>{
  const {env,tickets}=stub();
  let modelCalls=0, nextId=8400;
  env.AI={run:async(_model,req)=>{modelCalls++;
    const last=String(req.messages.at(-1)?.content||"");
    const answer=last.includes("йўриқномасини")
      ? {action:"answer",answer:"HSK AI йўриқномасини шу ердан кўринг:"}
      : {action:"handoff",answer:""};
    return {response:JSON.stringify(answer)};
  }};
  const calls=[],orig=globalThis.fetch;
  globalThis.fetch=async(url,init)=>{
    calls.push({method:String(url).split("/").pop(),data:JSON.parse(init.body)});
    return Response.json({ok:true,result:{message_id:nextId++}});
  };
  const from={id:8400,language_code:"uz",username:"learner"};
  const ask=(id,text)=>call(env,{update_id:id,message:{chat:{id:8400,type:"private"},from,message_id:id,text}});
  try{
    assert.equal((await ask(8401,"йўриқномасини юбора оласизми?")).status,200);
    assert.equal((await ask(8402,"айфон иловасининг силкасини ташлаб беринг")).status,200);
    assert.equal((await ask(8403,"силкани бошдан ташлаб бер нг")).status,200);
    const messages=calls.filter(x=>x.method==="sendMessage").map(x=>x.data.text);
    assert.equal(messages.length,3);
    assert.match(messages[0],/hskai\.app\/uz\/guide\/faq/);
    assert.match(messages[1],/Билимлар базамда/);
    assert.match(messages[2],/Билимлар базамда/);
    assert.ok(!messages.slice(1).some(m=>/https:\/\/hskai\.app\s*$/m.test(m)),"home URL is not an iPhone app deep-link");
    assert.ok(messages.every(m=>!m.includes("HSK AI ҳақидаги саволингизни аниқроқ ёзинг")));
    assert.ok(modelCalls>=3 && modelCalls<=12,"uncertain answers trigger finite verified-file expansion");
    assert.equal(tickets.size,0);
  }finally{globalThis.fetch=orig;}
});


test("start and every FAQ selection reach AI context; R2 checks nearest topic and uncertainty is explicit",async()=>{
  const {env,tickets,conversations}=stub();
  const sourceSha="c8c1aaf5b2b07b40878017ae8f6bb7a60da4b073";
  const reads=[],prompts=[],calls=[];
  env.KB={get:async key=>{
    reads.push(key);
    const topic=key.slice("knowledge/".length,-".json".length);
    return {json:async()=>({topic,source_commit:sourceSha,
      facts:["HSK AI verified "+topic+" support details."]})};
  }};
  env.AI={run:async(model,request)=>{
    prompts.push(request.messages);
    const question=String(request.messages.at(-1).content);
    return {response:JSON.stringify(question.includes("Pro")
      ? {action:"handoff",answer:""}
      : {action:"answer",answer:"Проверьте способ входа Google или Telegram."})};
  }};
  const before=globalThis.fetch;let n=12001;
  globalThis.fetch=async(url,init)=>{
    calls.push({method:String(url).split("/").pop(),body:JSON.parse(init.body)});
    return Response.json({ok:true,result:{message_id:n++}});
  };
  const user={id:12000,language_code:"ru"};
  const start={update_id:12000,message:{chat:{id:12000,type:"private"},from:user,message_id:1,text:"/start"}};
  const option=(id,key)=>({update_id:id,callback_query:{id:"q"+id,from:user,
    message:{chat:{id:12000,type:"private"},message_id:id},data:"help:"+key}});
  const ask=(id,text)=>({update_id:id,message:{chat:{id:12000,type:"private"},from:user,message_id:id,text}});
  try{
    assert.equal((await call(env,start)).status,200);
    assert.match(conversations[0].text,/start/);
    assert.equal(calls.filter(x=>x.method==="sendMessage").length,1);
    assert.equal((await call(env,option(12001,"payment"))).status,200);
    assert.match(conversations[0].text,/FAQ selected: payment/);
    assert.equal(calls.filter(x=>x.method==="sendMessage").length,1,
      "FAQ selection must not produce a canned chat reply");
    assert.equal((await call(env,ask(12002,"Как оплатить Pro?"))).status,200);
    assert.ok(prompts[0].some(x=>String(x.content).includes("FAQ selected: payment")));
    assert.ok(reads.includes("knowledge/payments.json"));
    assert.ok(reads.includes("knowledge/subscriptions.json"));
    assert.match(calls.filter(x=>x.method==="sendMessage").at(-1).body.text,/нет подтверждённой информации/);
    assert.equal(tickets.size,0,"no automatic operator ticket on missing facts");

    reads.length=0;
    assert.equal((await call(env,option(12003,"account"))).status,200);
    assert.equal((await call(env,ask(12004,"Android вход не работает"))).status,200);
    assert.ok(prompts.at(-1).some(x=>String(x.content).includes("FAQ selected: account")));
    assert.ok(reads.includes("knowledge/android.json"));
    assert.ok(reads.includes("knowledge/accounts.json"));
    assert.match(calls.filter(x=>x.method==="sendMessage").at(-1).body.text,/Google или Telegram/);
  }finally{globalThis.fetch=before;}
});

test("AI identifies a credible crash, forwards redacted report and keeps answering", async()=>{
  const {env,calls,tickets,links}=stub();
  const events=[];
  env.AI={run:async()=>({response:JSON.stringify({
    action:"report",kind:"bug",
    answer:"Похоже, приложение неожиданно закрывается после открытия урока.",
    summary:"Приложение закрывается сразу после открытия урока на Android."
  })})};
  const old=globalThis.fetch;
  globalThis.fetch=async(url,init)=>{
    const method=String(url).split("/").pop();
    events.push({method,data:JSON.parse(init.body)});
    return Response.json({ok:true,result:{message_id:800+events.length}});
  };
  try {
    const from={id:3001,language_code:"ru",username:"user_crash"};
    const msg=(id,txt)=>({update_id:id,message:{chat:{id:3001,type:"private"},from,message_id:id,text:txt}});
    assert.equal((await call(env,msg(8001,"Android приложение вылетает, когда открываю урок 2"))).status,200);
    assert.equal(events.filter(e=>e.data.chat_id==="-100234"&&e.method==="sendMessage").length,1);
    assert.match(events.find(e=>e.data.chat_id==="-100234").data.text,/Possible defect/);
    assert.equal(tickets.size,1);
    assert.equal([...tickets.values()][0].source,"ai_report");
    assert.equal(events.filter(e=>e.data.chat_id===3001&&e.method==="sendMessage").length,1);
    assert.match(events.find(e=>e.data.chat_id===3001&&e.method==="sendMessage").data.text,/Сообщил специалистам об ошибке/);
    assert.ok(links.size>0);
    // A later question must be processed by AI rather than copied to human operator.
    env.AI.run=async()=>({response:JSON.stringify({action:"answer",answer:"Откройте раздел уроков в приложении."})});
    assert.equal((await call(env,msg(8002,"Где находятся уроки HSK?"))).status,200);
    assert.equal(events.filter(e=>e.method==="copyMessage").length,0);
    assert.ok(events.some(e=>e.data.chat_id===3001&&e.data.text==="Откройте раздел уроков в приложении."));
  } finally {globalThis.fetch=old;}
});

test("AI feedback is reported, but navigation confusion stays a normal AI answer",async()=>{
  const {env,tickets}=stub();
  let response={action:"answer",answer:"Для занятий откройте вкладку Курсы и выберите уровень."};
  env.AI={run:async()=>({response:JSON.stringify(response)})};
  const events=[],old=globalThis.fetch;
  globalThis.fetch=async(url,init)=>{
    const method=String(url).split("/").pop();events.push({method,data:JSON.parse(init.body)});
    return Response.json({ok:true,result:{message_id:2000+events.length}});
  };
  try{
    const from={id:3040,language_code:"ru"};
    const mk=(id,text)=>({update_id:id,message:{chat:{id:3040,type:"private"},from,message_id:id,text}});
    assert.equal((await call(env,mk(9001,"Я по ошибке открыл настройки, где уроки?"))).status,200);
    assert.equal(tickets.size,0);
    response={action:"report",kind:"feedback",answer:"Спасибо, этот момент интерфейса действительно стоит улучшить.",summary:"Пользователю трудно различать переходы между экранами настроек и уроков."};
    assert.equal((await call(env,mk(9002,"Неудобно, что в интерфейсе кнопка урока почти незаметна"))).status,200);
    assert.equal(tickets.size,1);
    assert.ok(events.some(e=>e.method==="sendMessage"&&e.data.chat_id==="-100234"&&e.data.text.includes("Product feedback")));
  } finally{globalThis.fetch=old;}
});

test("AI report delivery failure is disclosed, never falsely confirmed",async()=>{
  const {env,tickets}=stub();
  env.AI={run:async()=>({response:JSON.stringify({
    action:"report",kind:"bug",answer:"Похоже на ошибку приложения.",
    summary:"Приложение закрывается после нажатия кнопки начала урока."
  })})};
  const events=[],old=globalThis.fetch;
  globalThis.fetch=async(url,init)=>{
    const method=String(url).split("/").pop();const data=JSON.parse(init.body);
    events.push({method,data});
    if(method==="sendMessage"&&data.chat_id==="-100234")return Response.json({ok:false,description:"unavailable"},{status:503});
    return Response.json({ok:true,result:{message_id:4000+events.length}});
  };
  try{
    const msg={update_id:9100,message:{chat:{id:3150,type:"private"},
      from:{id:3150,language_code:"ru"},message_id:9100,text:"После нажатия начать урок приложение полностью закрывается"}};
    assert.equal((await call(env,msg)).status,200);
    assert.ok(events.some(e=>e.data.chat_id===3150&&/Не смог передать обращение/.test(e.data.text)));
    assert.ok(!events.some(e=>e.data.chat_id===3150&&/Сообщил специалистам об ошибке/.test(e.data.text)));
    assert.ok([...tickets.values()].every(t=>t.status==="closed"));
  } finally{globalThis.fetch=old;}
});

test("explicit /operator upgrades an auto report into human-chat mode",async()=>{
  const {env,tickets}=stub();
  env.AI={run:async()=>({response:JSON.stringify({
    action:"report",kind:"feedback",answer:"Этот отзыв полезен.",
    summary:"Кнопки уроков плохо различимы на экране телефона."
  })})};
  const events=[],old=globalThis.fetch;
  globalThis.fetch=async(url,init)=>{
    const method=String(url).split("/").pop();
    events.push({method,data:JSON.parse(init.body)});
    return Response.json({ok:true,result:{message_id:5000+events.length}});
  };
  try {
    const from={id:3220,language_code:"ru"};
    const mk=(id,text)=>({update_id:id,message:{chat:{id:3220,type:"private"},from,message_id:id,text}});
    await call(env,mk(9200,"Мне не нравится дизайн кнопок урока, плохо видно"));
    assert.equal([...tickets.values()][0].source,"ai_report");
    await call(env,mk(9201,"/operator"));
    assert.notEqual([...tickets.values()][0].source,"ai_report");
    await call(env,mk(9202,"Передайте оператору ещё эту деталь"));
    assert.equal(events.filter(e=>e.method==="copyMessage"&&e.data.chat_id==="-100234").length,1);
  }finally{globalThis.fetch=old;}
});

test("actionable screenshot report is forwarded to private specialists even without AI share flag",async()=>{
  const {env}=stub();
  let imageProvided=false;
  env.AI={run:async(model,request)=>{
    imageProvided=Array.isArray(request.messages.at(-1).content)&&
      request.messages.at(-1).content.some(p=>p.type==="image_url");
    return {response:JSON.stringify({
      action:"report",kind:"bug",answer:"На скриншоте видно сообщение об ошибке. Описание передам для проверки.",
      summary:"После запуска теста на Android появляется сообщение об ошибке."
    })};
  }};
  const calls=[],old=globalThis.fetch;
  globalThis.fetch=async(url,init)=>{
    const name=String(url);
    if(name.includes("/file/bot"))return new Response(Uint8Array.from([
      0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),{status:200,headers:{"content-type":"image/png"}});
    const method=name.split("/").pop();
    calls.push({method,data:JSON.parse(init.body)});
    return Response.json({ok:true,result:method==="getFile"?{file_path:"photos/picture.png"}:{message_id:7000+calls.length}});
  };
  try{
    const update={update_id:9333,message:{chat:{id:3333,type:"private"},from:{id:3333,language_code:"ru"},
      message_id:9333,caption:"После урока показана ошибка",photo:[{file_id:"safe-photo",file_size:8}]}};
    assert.equal((await call(env,update)).status,200);
    assert.equal(imageProvided,true);
    const admin=calls.filter(x=>String(x.data.chat_id)==="-100234");
    assert.equal(admin.length,2);
    assert.deepEqual(admin.map(x=>x.method),["sendMessage","copyMessage"]);
    assert.equal(admin[1].data.message_id,9333);
    assert.ok(admin[0].data.text.includes("Screenshot follows this report"));
    assert.equal(calls.filter(x=>x.method==="copyMessage").length,1);
  }finally{globalThis.fetch=old;}
});

test("AI forwards approved screenshot as an actual Telegram image, with linked operator reply",async()=>{
  const {env,links,tickets}=stub();
  const calls=[],old=globalThis.fetch;
  env.AI={run:async(model,req)=>{
    assert.equal(req.messages.at(-1).content[1].type,"image_url");
    return {response:JSON.stringify({action:"report",kind:"feedback",
      answer:"Это предложение по интерфейсу стоит проверить.",
      summary:"Кнопка начала урока кажется слишком маленькой и труднодоступной.",
      image_safe_to_share:true})};
  }};
  globalThis.fetch=async(url,init)=>{
    const name=String(url);
    if(name.includes("/file/bot"))return new Response(Uint8Array.from([
      0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),{status:200});
    const method=name.split("/").pop();
    calls.push({method,data:JSON.parse(init.body)});
    return Response.json({ok:true,result:method==="getFile"?{file_path:"photos/screenshot.png"}:{message_id:5100+calls.length}});
  };
  try {
    const update={update_id:99011,message:{chat:{id:8113,type:"private"},
      from:{id:8113,language_code:"ru"},message_id:99011,
      caption:"Кнопка начала урока слишком маленькая, неудобно",
      photo:[{file_id:"public-app-screenshot",file_size:8}]}};
    assert.equal((await call(env,update)).status,200);
    assert.equal(tickets.size,1);
    const operator=calls.filter(x=>x.data.chat_id==="-100234");
    assert.deepEqual(operator.map(x=>x.method),["sendMessage","copyMessage"]);
    assert.equal(operator[1].data.from_chat_id,8113);
    assert.equal(operator[1].data.message_id,99011);
    assert.ok(links.has(5100+calls.indexOf(operator[0])+1));
    assert.ok(links.has(5100+calls.indexOf(operator[1])+1));
    assert.ok(calls.some(x=>x.method==="sendMessage"&&x.data.chat_id===8113&&
      /Передал описание оператору/.test(x.data.text)&&
      !/Скриншот не удалось/.test(x.data.text)));
  }finally{globalThis.fetch=old;}
});

test("AI forwards the report but warns learner when screenshot copy fails",async()=>{
  const {env}=stub();
  const calls=[],old=globalThis.fetch;
  env.AI={run:async()=>({response:JSON.stringify({action:"report",kind:"bug",
    answer:"На скриншоте показана ошибка запуска.",
    summary:"После открытия урока появляется ошибка на экране.",
    image_safe_to_share:true})})};
  globalThis.fetch=async(url,init)=>{
    const name=String(url);
    if(name.includes("/file/bot"))return new Response(Uint8Array.from([
      0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),{status:200});
    const method=name.split("/").pop();
    const data=JSON.parse(init.body);calls.push({method,data});
    if(method==="copyMessage")return Response.json({ok:false,description:"Forbidden"},{status:403});
    return Response.json({ok:true,result:method==="getFile"?{file_path:"photos/safe.png"}:{message_id:7300+calls.length}});
  };
  try{
    const message={update_id:99012,message:{chat:{id:8114,type:"private"},
      from:{id:8114,language_code:"ru"},message_id:99012,
      caption:"Показана ошибка при запуске урока",photo:[{file_id:"safe",file_size:8}]}};
    assert.equal((await call(env,message)).status,200);
    assert.ok(calls.some(x=>x.method==="sendMessage"&&x.data.chat_id===8114&&
      /Скриншот не удалось передать/.test(x.data.text)));
    assert.ok(calls.some(x=>x.method==="sendMessage"&&x.data.chat_id==="-100234"));
  } finally{globalThis.fetch=old;}
});

test("75 sequential Support AI questions per user remain answerable without daily or global quotas",async()=>{
  const {env,quotas}=stub();
  let modelCalls=0;
  env.AI={run:async()=>({response:JSON.stringify({action:"answer",answer:"HSK AI ҳақида тасдиқланган маълумот."})})};
  const sent=[],original=globalThis.fetch;
  globalThis.fetch=async(url,init)=>{
    const method=String(url).split("/").pop(),data=JSON.parse(init.body);
    if(method==="sendMessage"&&data.chat_id===82002)sent.push(data.text);
    return Response.json({ok:true,result:{message_id:82002+sent.length}});
  };
  try{
    env.AI.run=async()=>{modelCalls++;return {response:JSON.stringify({
      action:"answer",answer:"HSK AI хитой тилини ўрганиш учун хизмат қилади."
    })};};
    const from={id:82002,language_code:"uz"};
    for(let i=0;i<75;i++){
      const update={update_id:950000+i,message:{chat:{id:82002,type:"private"},
        from,message_id:92000+i,text:"HSK AI ҳақида маълумот беринг. Савол "+i}};
      const response=await call(env,update);
      assert.equal(response.status,200,"webhook update "+i+" must succeed");
    }
    assert.equal(modelCalls,75);
    assert.equal(sent.length,75);
    assert.ok(sent.every(s=>s.includes("HSK AI хитой тилини ўрганиш")));
    assert.equal([...quotas.keys()].filter(k=>/^(?:ai-user:|ai-global:|msg-user:)/.test(k)).length,0);
  }finally{globalThis.fetch=original;}
});

test("FAQ callbacks and AI still work after 60 messages without a user message quota",async()=>{
  const {env,quotas}=stub();
  const outgoing=[],original=globalThis.fetch;
  env.AI={run:async()=>({response:JSON.stringify({action:"answer",answer:"Мавжуд билимлар асосида маълумот."})})};
  globalThis.fetch=async(url,init)=>{
    const method=String(url).split("/").pop(),data=JSON.parse(init.body);
    outgoing.push({method,data});
    return Response.json({ok:true,result:{message_id:6100+outgoing.length}});
  };
  try{
    const from={id:82003,language_code:"ru"};
    for(let i=0;i<65;i++){
      assert.equal((await call(env,{update_id:970000+i,message:{
        chat:{id:82003,type:"private"},from,message_id:i+1000,
        text:"Расскажите о HSK AI: вопрос "+i
      }})).status,200);
    }
    const faq={update_id:971000,callback_query:{id:"cb_after_65",from,
      message:{message_id:99000,chat:{id:82003,type:"private"}},data:"help:account"}};
    assert.equal((await call(env,faq)).status,200);
    assert.ok(outgoing.some(x=>x.method==="answerCallbackQuery"));
    assert.equal(quotas.size,0);
  }finally{globalThis.fetch=original;}
});

test("automatic bug/feedback delivery has no hidden daily limit, including after prior 3/3 quota",async()=>{
  const {env,quotas,tickets,links}=stub();
  const userId=82220;
  quotas.set("ai-report:"+userId+":"+new Date().toISOString().slice(0,10),3);
  let n=0;
  env.AI={run:async()=>({response:JSON.stringify({
    action:"report",kind:n++%2===0?"bug":"feedback",
    answer:"Мурожаатингиз бўйича маълумотни ёзиб олдим.",
    summary:"Фойдаланувчи HSK AI илова интерфейси ёки дарсларидаги муаммони қайд этди."
  })})};
  const sent=[],oldFetch=globalThis.fetch;
  globalThis.fetch=async(url,init)=>{
    const method=String(url).split("/").pop(),payload=JSON.parse(init.body);
    sent.push({method,payload});
    return Response.json({ok:true,result:{message_id:32000+sent.length}});
  };
  try{
    const from={id:userId,language_code:"uz",username:"report_tester"};
    for(let i=0;i<7;i++){
      const update={update_id:981000+i,message:{
        chat:{id:userId,type:"private"},from,message_id:981000+i,
        text:"HSK AI дарси ёпилиб қоляпти, такрорий тест "+(i+1)
      }};
      assert.equal((await call(env,update)).status,200);
    }
    const admin=sent.filter(x=>x.method==="sendMessage"&&x.payload.chat_id==="-100234");
    const replies=sent.filter(x=>x.method==="sendMessage"&&x.payload.chat_id===userId);
    assert.equal(admin.length,7,"each independently classified report reaches operator");
    assert.equal(replies.length,7);
    assert.ok(replies.every(x=>/мутахассисларга хабар бердим|операторга етказдим/.test(x.payload.text)),
      "bugs confirm specialists and feedback keeps its existing delivery confirmation");
    assert.ok(replies.some(x=>/Хатолик ҳақида мутахассисларга хабар бердим/.test(x.payload.text)));
    assert.equal(quotas.get("ai-report:"+userId+":"+new Date().toISOString().slice(0,10)),3,
      "legacy daily quota is ignored and never incremented");
    assert.equal(tickets.size,1,"reports share a single open operator reply ticket");
    assert.equal([...tickets.values()][0].source,"ai_report");
    assert.equal(links.size,7,"each forwarded report supports operator replies");
  }finally{globalThis.fetch=oldFetch;}
});

test("operator Telegram delivery failure is still disclosed when no report quota exists",async()=>{
  const {env,quotas}=stub();
  env.AI={run:async()=>({response:JSON.stringify({
    action:"report",kind:"bug",
    answer:"Илова ёпилиши такрорланаётганини тушундим.",
    summary:"Android HSK2 дарси очилганда илова ёпилиб қолади."
  })})};
  const sent=[],oldFetch=globalThis.fetch,oldWarn=console.warn,warning=[];
  console.warn=(...args)=>warning.push(args);
  globalThis.fetch=async(url,init)=>{
    const method=String(url).split("/").pop(),body=JSON.parse(init.body);
    sent.push({method,body});
    if(method==="sendMessage"&&body.chat_id==="-100234")
      return Response.json({ok:false,description:"Forbidden"},{status:403});
    return Response.json({ok:true,result:{message_id:58000+sent.length}});
  };
  try{
    const msg={update_id:982000,message:{chat:{id:82221,type:"private"},
      from:{id:82221,language_code:"uz"},message_id:982000,
      text:"Android HSK2 дарсида Start босилганда илова ёпилади"}};
    assert.equal((await call(env,msg)).status,200);
    assert.ok(sent.some(x=>x.method==="sendMessage"&&x.body.chat_id===82221&&
      /Мурожаатни операторга етказа олмадим/.test(x.body.text)));
    assert.ok(warning.some(args=>args[0]==="support_ai_report_delivery_failed"&&
      args[1]==="operator_send"&&args[2]==="telegram_http_403"));
    assert.equal(quotas.size,0);
  }finally{globalThis.fetch=oldFetch;console.warn=oldWarn;}
});



function enablePendingImageTestDb(env){
  const records=new Map(),oldPrepare=env.DB.prepare.bind(env.DB);
  env.DB.prepare=(sql)=>{
    if(!sql.includes("pending_images"))return oldPrepare(sql);
    return {bind(...args){return {
      async first(){
        if(sql.includes("WHERE tg_id=? AND status='pending'")){
          return [...records.values()].filter(x=>x.tg_id===args[0]&&x.status==="pending"&&x.expires_at>=args[1])
            .sort((x,y)=>y.created_at-x.created_at||y.message_id-x.message_id)[0]||null;
        }
        if(sql.includes("WHERE tg_id=? AND message_id=? AND token=?")){
          const row=records.get(args[0]+":"+args[1]);
          return row?.token===args[2]?row:null;
        }
        return null;
      },
      async run(){
        if(sql.startsWith("INSERT INTO pending_images")){
          const [tg_id,message_id,file_id,file_size,media_type,mime_type,lang,source,created_at,expires_at,token]=args;
          const key=tg_id+":"+message_id;
          if(records.has(key))throw Error("duplicate");
          records.set(key,{tg_id,message_id,file_id,file_size,media_type,mime_type,lang,source,created_at,expires_at,token,status:"pending",claimed_at:null});
          return {meta:{changes:1}};
        }
        if(sql.startsWith("UPDATE pending_images SET status='processing'")){
          const [now,id,messageId,token,maxLease]=args,row=records.get(id+":"+messageId);
          if(!row||row.token!==token)return {meta:{changes:0}};
          if(maxLease===undefined?row.status!=="pending":
             !(row.status==="pending"||(row.status==="processing"&&row.claimed_at<=maxLease)))
            return {meta:{changes:0}};
          row.status="processing";row.claimed_at=now;return {meta:{changes:1}};
        }
        if(sql.startsWith("UPDATE pending_images SET status='pending'")){
          const row=records.get(args[0]+":"+args[1]);
          if(row?.token===args[2]){row.status="pending";row.claimed_at=null;return {meta:{changes:1}};}
          return {meta:{changes:0}};
        }
        if(sql.startsWith("DELETE FROM pending_images")){
          if(args.length===1){
            let n=0;for(const [k,v] of records)if(v.tg_id===args[0]){records.delete(k);n++;}
            return {meta:{changes:n}};
          }
          const row=records.get(args[0]+":"+args[1]);
          if(row?.token!==args[2])return {meta:{changes:0}};
          records.delete(args[0]+":"+args[1]);return {meta:{changes:1}};
        }
        throw Error("Unmocked pending SQL: "+sql);
      }
    }}};
  };
  return records;
}

function imageFollowUpFixture(){
  const {env,conversations}=stub();
  const records=enablePendingImageTestDb(env);
  const queueSent=[],telegramCalls=[];
  let aiCalls=0,queueFails=false;
  env.IMAGE_DELAY_QUEUE={async send(body,options){
    if(queueFails)throw Error("queue_failure");
    queueSent.push({body,options});
  }};
  env.AI={run:async(model,request)=>{
    aiCalls++;
    const content=request.messages.at(-1).content;
    assert.ok(Array.isArray(content));
    assert.ok(content.some(p=>p.type==="image_url"));
    return {response:JSON.stringify({action:"answer",answer:"Расм ва изоҳни биргаликда таҳлил қилдим."})};
  }};
  const jpegOrPng=Uint8Array.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
  const stubFetch=async(url,init)=>{
    if(String(url).includes("/file/bot"))return new Response(jpegOrPng,{status:200});
    const method=String(url).split("/").pop(),body=JSON.parse(init.body);
    telegramCalls.push({method,body});
    return Response.json({ok:true,result:method==="getFile"?{file_path:"photos/qa.png"}:{message_id:95000+telegramCalls.length}});
  };
  const photo=(id,userId=83001,caption=undefined)=>({update_id:id,message:{
    chat:{id:userId,type:"private"},from:{id:userId,language_code:"uz",username:"test_photo"},
    message_id:id,photo:[{file_id:"stored-photo-"+id,file_size:8}],...(caption?{caption}:{})
  }});
  const textMsg=(id,text,userId=83001)=>({update_id:id,message:{
    chat:{id:userId,type:"private"},from:{id:userId,language_code:"uz",username:"test_photo"},
    message_id:id,text
  }});
  const queueBatch=message=>({messages:[{body:message,ack(){this.acknowledged=true;},retry(opts){this.retried=opts;}}]});
  return {env,records,queueSent,telegramCalls,conversations,stubFetch,photo,textMsg,queueBatch,
    getAiCalls:()=>aiCalls,setQueueFails(v){queueFails=v;}};
}

test("E2E photo then explanation: one Vision call with joint text+original image, delayed Queue cannot duplicate it",async()=>{
  const f=imageFollowUpFixture(),oldFetch=globalThis.fetch;
  globalThis.fetch=f.stubFetch;
  try{
    const photo=f.photo(501001);
    assert.equal((await call(f.env,photo)).status,200);
    assert.equal(f.getAiCalls(),0);
    assert.equal(f.queueSent.length,1);
    assert.equal(f.queueSent[0].options.delaySeconds,60);
    assert.equal(f.telegramCalls.length,0);
    assert.equal((await call(f.env,photo)).status,200,"replayed webhook is ignored");
    assert.equal(f.queueSent.length,1,"duplicate photo must not create second timer");
    const originalAI=f.env.AI.run;
    f.env.AI.run=async(model,request)=>{
      assert.equal(request.messages.at(-1).content[0].text,
        "Дарс тугмаси жуда кичик, уни каттароқ қилинг");
      return originalAI(model,request);
    };
    assert.equal((await call(f.env,f.textMsg(501002,"Дарс тугмаси жуда кичик, уни каттароқ қилинг"))).status,200);
    assert.equal(f.getAiCalls(),1);
    assert.equal(f.records.size,0,"pending image is consumed");
    assert.equal(f.telegramCalls.filter(x=>x.method==="sendMessage"&&x.body.chat_id===83001).length,1);
    const queue=f.queueBatch(f.queueSent[0].body);
    await worker.queue(queue,f.env);
    assert.equal(queue.messages[0].acknowledged,true);
    assert.equal(f.getAiCalls(),1,"late delivery never responds again");
  }finally{globalThis.fetch=oldFetch;}
});

test("E2E photo without text: Queue waits until due and Vision replies once",async()=>{
  const f=imageFollowUpFixture(),oldFetch=globalThis.fetch;
  globalThis.fetch=f.stubFetch;
  try{
    await call(f.env,f.photo(502001));
    const early=f.queueBatch(f.queueSent[0].body);
    await worker.queue(early,f.env);
    assert.ok(early.messages[0].retried?.delaySeconds>0);
    assert.equal(f.getAiCalls(),0);
    const row=[...f.records.values()][0];row.expires_at=Math.floor(Date.now()/1000)-1;
    const due=f.queueBatch(f.queueSent[0].body);
    await worker.queue(due,f.env);
    assert.equal(due.messages[0].acknowledged,true);
    assert.equal(f.getAiCalls(),1);
    assert.equal(f.records.size,0);
    assert.equal(f.telegramCalls.filter(x=>x.method==="sendMessage"&&x.body.chat_id===83001).length,1);
  }finally{globalThis.fetch=oldFetch;}
});

test("E2E personal bank verification explanation cancels image and never reaches Vision",async()=>{
  const f=imageFollowUpFixture(),oldFetch=globalThis.fetch;
  globalThis.fetch=f.stubFetch;
  try{
    await call(f.env,f.photo(503001));
    await call(f.env,f.textMsg(503002,"Менинг Lava тўловимни текшириб бер, пул ечилмаган"));
    assert.equal(f.getAiCalls(),0);
    assert.equal(f.records.size,0);
    assert.ok(f.telegramCalls.some(x=>x.body.text?.includes("Шахсий тўлов")));
    const q=f.queueBatch(f.queueSent[0].body);
    await worker.queue(q,f.env);
    assert.equal(q.messages[0].acknowledged,true);
    assert.equal(f.getAiCalls(),0);
  }finally{globalThis.fetch=oldFetch;}
});

test("E2E /start cancels pending screenshot and must not deliver a stale AI answer",async()=>{
  const f=imageFollowUpFixture(),oldFetch=globalThis.fetch;
  globalThis.fetch=f.stubFetch;
  try{
    await call(f.env,f.photo(504001));
    await call(f.env,f.textMsg(504002,"/start"));
    assert.equal(f.records.size,0);
    const q=f.queueBatch(f.queueSent[0].body);
    await worker.queue(q,f.env);
    assert.equal(f.getAiCalls(),0);
    assert.ok(f.telegramCalls.some(x=>x.body.text?.includes("HSK AI")));
  }finally{globalThis.fetch=oldFetch;}
});

test("E2E captioned image bypasses delay and is immediately analyzed",async()=>{
  const f=imageFollowUpFixture(),oldFetch=globalThis.fetch;
  globalThis.fetch=f.stubFetch;
  try{
    await call(f.env,f.photo(505001,83001,"Дарс тугмасини тополмаяпман"));
    assert.equal(f.queueSent.length,0);
    assert.equal(f.getAiCalls(),1);
    assert.equal(f.records.size,0);
  }finally{globalThis.fetch=oldFetch;}
});

test("E2E failure to enqueue falls back to immediate Vision instead of losing the photo",async()=>{
  const f=imageFollowUpFixture(),oldFetch=globalThis.fetch,oldWarn=console.warn;
  globalThis.fetch=f.stubFetch;console.warn=()=>{};
  try{
    f.setQueueFails(true);
    await call(f.env,f.photo(506001));
    assert.equal(f.queueSent.length,0);
    assert.equal(f.getAiCalls(),1);
    assert.equal(f.records.size,0);
  }finally{globalThis.fetch=oldFetch;console.warn=oldWarn;}
});


test("E2E screenshot + later feedback forwards its ORIGINAL photo to operator once",async()=>{
  const f=imageFollowUpFixture(),oldFetch=globalThis.fetch;
  let modelCalls=0;
  f.env.AI.run=async(_model,request)=>{
    modelCalls++;
    assert.equal(request.messages.at(-1).content[0].text,"Дарсни бошлаш тугмаси кўринмайди");
    return {response:JSON.stringify({action:"report",kind:"feedback",
      answer:"Тугма кўриниши бўйича таклифингизни тушундим.",
      summary:"Фойдаланувчи дарсни бошлаш тугмаси яхши кўринмаслигини таъкидлади.",
      image_safe_to_share:true})};
  };
  globalThis.fetch=f.stubFetch;
  try{
    const photo=f.photo(507001);
    await call(f.env,photo);
    assert.equal(f.telegramCalls.length,0);
    await call(f.env,f.textMsg(507002,"Дарсни бошлаш тугмаси кўринмайди"));
    const operator=f.telegramCalls.filter(x=>x.body.chat_id==="-100234");
    assert.deepEqual(operator.map(x=>x.method),["sendMessage","copyMessage"]);
    assert.equal(operator[1].body.from_chat_id,83001);
    assert.equal(operator[1].body.message_id,507001,"use screenshot id, NOT the later text id");
    assert.ok(operator[0].body.text.includes("Дарсни бошлаш тугмаси кўринмайди"));
    assert.equal(f.records.size,0);
    const event=f.queueBatch(f.queueSent[0].body);
    await worker.queue(event,f.env);
    assert.equal(event.messages[0].acknowledged,true);
    assert.equal(modelCalls,1);
  }finally{globalThis.fetch=oldFetch;}
});


test("E2E operator opt-in during screenshot hold forwards the original image and prevents AI timeout",async()=>{
  const f=imageFollowUpFixture(),oldFetch=globalThis.fetch;
  globalThis.fetch=f.stubFetch;
  try{
    await call(f.env,f.photo(508001));
    assert.equal(f.queueSent.length,1);
    assert.equal(f.getAiCalls(),0);
    await call(f.env,f.textMsg(508002,"/operator"));
    const admin=f.telegramCalls.filter(x=>x.body.chat_id==="-100234");
    assert.deepEqual(admin.map(x=>x.method),["sendMessage","copyMessage"]);
    assert.equal(admin[1].body.from_chat_id,83001);
    assert.equal(admin[1].body.message_id,508001);
    assert.equal(f.records.size,0);
    const q=f.queueBatch(f.queueSent[0].body);
    await worker.queue(q,f.env);
    assert.equal(q.messages[0].acknowledged,true);
    assert.equal(f.getAiCalls(),0);
  }finally{globalThis.fetch=oldFetch;}
});


test("bug report success confirms specialist review in three languages without forcing any AI answer text",async()=>{
  const {COPY}=await import("../src/content.js");
  for(const lang of ["ru","tj","uz"]){
    assert.ok(COPY[lang].bugReportSent);
    assert.match(COPY[lang].bugReportSent,/специалист|мутахассис|мутахассислар/i);
    assert.doesNotMatch(COPY[lang].bugReportSent,/оператор|operator/i);
    assert.ok(COPY[lang].reportSent,"other feedback remains separate from error notice");
    assert.ok(COPY[lang].reportFailed,"failed notification remains distinguishable");
  }
});


test("actual Lava checkout screenshot with email + error explanation is forwarded despite AI classifying it as answer",async()=>{
  const f=imageFollowUpFixture(),old=globalThis.fetch;
  f.env.AI.run=async(_model,req)=>{
    assert.ok(req.messages.at(-1).content.some(p=>p.type==="image_url"));
    assert.ok(req.messages.at(-1).content[0].text.includes("хатолик"));
    return {response:JSON.stringify({action:"answer",
      answer:"Тўлов хизмати жавоб бермаган. Кейинроқ яна синашингиз мумкин."})};
  };
  globalThis.fetch=f.stubFetch;
  try{
    await call(f.env,f.photo(509001));
    await call(f.env,f.textMsg(509002,"обуна олишда манабунака хатолик чкаяпти"));
    const operator=f.telegramCalls.filter(x=>x.body.chat_id==="-100234");
    assert.deepEqual(operator.map(x=>x.method),["sendMessage","copyMessage"]);
    assert.equal(operator[1].body.from_chat_id,83001);
    assert.equal(operator[1].body.message_id,509001);
    assert.ok(operator[0].body.text.includes("обуна олишда"));
    const response=f.telegramCalls.find(x=>x.method==="sendMessage"&&x.body.chat_id===83001);
    assert.ok(response.body.text.includes("Хатолик ҳақида мутахассисларга хабар бердим"));
    assert.ok(response.body.text.includes("Кейинроқ яна синашингиз"));
    assert.equal(f.records.size,0);
    const queued=f.queueBatch(f.queueSent[0].body);
    await worker.queue(queued,f.env);
    assert.equal(queued.messages[0].acknowledged,true);
    assert.equal(f.telegramCalls.filter(x=>x.method==="copyMessage").length,1);
  }finally{globalThis.fetch=old;}
});

test("model's negative image-sharing flag does not suppress a genuine product error report screenshot",async()=>{
 const f=imageFollowUpFixture(),old=globalThis.fetch;
 f.env.AI.run=async()=>({response:JSON.stringify({action:"report",kind:"bug",
   answer:"Похоже на ошибку платежной страницы.",
   summary:"Платежная страница сервиса показывает ошибку при оформлении подписки.",
   image_safe_to_share:false})});
 globalThis.fetch=f.stubFetch;
 try{
   await call(f.env,f.photo(509101,83001,"Ошибка при оформлении подписки на платежной странице"));
   assert.deepEqual(f.telegramCalls.filter(x=>x.body.chat_id==="-100234").map(x=>x.method),
      ["sendMessage","copyMessage"]);
   assert.equal(f.telegramCalls.filter(x=>x.method==="copyMessage")[0].body.message_id,509101);
 }finally{globalThis.fetch=old;}
});

test("ordinary question with a screenshot is answered without creating an unsolicited specialist report",async()=>{
 const f=imageFollowUpFixture(),old=globalThis.fetch;
 f.env.AI.run=async()=>({response:JSON.stringify({action:"answer",
   answer:"Раздел уроков доступен в главном меню HSK AI."})});
 globalThis.fetch=f.stubFetch;
 try{
   await call(f.env,f.photo(509201,83001,"Где находится раздел уроков HSK AI?"));
   assert.equal(f.telegramCalls.filter(x=>x.body.chat_id==="-100234").length,0);
   assert.equal(f.telegramCalls.filter(x=>x.method==="copyMessage").length,0);
 }finally{globalThis.fetch=old;}
});


test("real Lava screenshot report is remembered: 'Ҳолиям тузалмади' continues prior problem, not unknown KB fallback",async()=>{
 const f=imageFollowUpFixture(),previous=globalThis.fetch;
 let turns=0;
 f.env.AI.run=async(_model,request)=>{
   turns++;
   if(turns===1){
     assert.ok(request.messages.at(-1).content.some(x=>x.type==="image_url"));
     return {response:JSON.stringify({action:"report",kind:"bug",
       summary:"Lava обуна тўлов хизматидан жавоб келмаяпти, checkout хатоси кўринди.",
       answer:"Тўлов саҳифаси ҳозир жавоб бермаяпти. Кейинроқ қайта синаш мумкин.",
       image_safe_to_share:false})};
   }
   const history=request.messages.filter(x=>x.role==="user"||x.role==="assistant").slice(0,-1);
   assert.ok(history.some(x=>x.role==="user"&&String(x.content).includes("Lava обуна")),
      "screenshot report summary must be present in subsequent model history");
   assert.ok(history.some(x=>x.role==="assistant"&&String(x.content).includes("мутахассисларга хабар бердим")),
      "actual successful specialist acknowledgment must be present in history");
   assert.equal(request.messages.at(-1).content,"Ҳолиям тузалмади");
   return {response:JSON.stringify({action:"answer",
     answer:"Тўлов хизматидаги аввалги муаммо давом этаётган экан. Мутахассисларга хабар берилган. Тўловни қайта-қайта тасдиқлашдан олдин ҳолатни текшириш мумкин."})};
 };
 globalThis.fetch=f.stubFetch;
 try {
   await call(f.env,f.photo(581001,83001,"обуна олишда Lava хатолик чкаяпти"));
   assert.equal(f.conversations.length,2);
   assert.equal(f.conversations[0].role,"user");
   assert.ok(f.conversations[0].text.includes("Lava обуна"));
   assert.equal(f.conversations[1].role,"assistant");
   await call(f.env,f.textMsg(581002,"Ҳолиям тузалмади"));
   assert.equal(turns,2,"follow-up requires only one additional model call");
   assert.equal(f.conversations.length,4);
   const texts=f.telegramCalls.filter(x=>x.method==="sendMessage"&&x.body.chat_id===83001).map(x=>x.body.text);
   assert.equal(texts.length,2);
   assert.ok(texts.at(-1).includes("аввалги муаммо давом"));
   assert.ok(!texts.at(-1).includes("Билимлар базамда"));
   assert.equal(f.telegramCalls.filter(x=>x.method==="copyMessage").length,1,
     "follow-up should not forward the same image a second time");
 }finally{globalThis.fetch=previous;}
});

test("image with ordinary answer is also remembered for follow-up without saving screenshot bytes or email",async()=>{
 const f=imageFollowUpFixture(),previous=globalThis.fetch;
 let turns=0;
 f.env.AI.run=async(_model,request)=>{
   turns++;
   if(turns===1)return {response:JSON.stringify({action:"answer",
     answer:"Бу HSK AI обуна ойнаси. Тўловга ўтиш тугмасини кўриб турибман."})};
   const previousMessages=request.messages.filter(x=>x.role==="user"||x.role==="assistant").slice(0,-1);
   assert.ok(previousMessages.some(x=>String(x.content).includes("обуна ойнаси")),
      "photo response should become context for next turn");
   return {response:JSON.stringify({action:"answer",
      answer:"Ҳа, аввалги расмдаги обуна ойнаси ҳақида гапиряпсиз."})};
 };
 globalThis.fetch=f.stubFetch;
 try{
   await call(f.env,f.photo(582001,83001,"Бу обуна ойнасида email customer@example.com бор"));
   assert.equal(f.conversations.length,2);
   assert.ok(f.conversations[0].text.includes("[email]"));
   assert.ok(!f.conversations[0].text.includes("customer@example.com"));
   assert.ok(!JSON.stringify(f.conversations).includes("stored-photo-"));
   await call(f.env,f.textMsg(582002,"Бу ерда нима қилишим керак?"));
   assert.equal(turns,2);
   assert.equal(f.conversations.length,4);
 }finally{globalThis.fetch=previous;}
});

test("bare photo then text report is saved once; delayed queue cannot double-save history",async()=>{
 const f=imageFollowUpFixture(),oldFetch=globalThis.fetch;
 f.env.AI.run=async()=>({response:JSON.stringify({action:"report",kind:"bug",
   answer:"Тўлов хизмати вақтинча жавоб бермаяпти.",
   summary:"Lava checkout хатолиги обуна тўлов саҳифасида юз берди."})});
 globalThis.fetch=f.stubFetch;
 try{
   await call(f.env,f.photo(583001));
   assert.equal(f.conversations.length,0);
   await call(f.env,f.textMsg(583002,"обуна олишда манабунака хатолик чкаяпти"));
   assert.equal(f.conversations.length,2);
   assert.ok(f.conversations[0].text.includes("Lava checkout"));
   const q=f.queueBatch(f.queueSent[0].body);
   await worker.queue(q,f.env);
   assert.equal(q.messages[0].acknowledged,true);
   assert.equal(f.conversations.length,2);
 }finally{globalThis.fetch=oldFetch;}
});

test("start resets recently saved image-report context",async()=>{
 const f=imageFollowUpFixture(),oldFetch=globalThis.fetch;
 f.env.AI.run=async()=>({response:JSON.stringify({action:"report",kind:"bug",
   answer:"Checkout error кўринмоқда.",summary:"Lava Pro тўловда хатолик бор."})});
 globalThis.fetch=f.stubFetch;
 try{
   await call(f.env,f.photo(584001,83001,"обуна олишда хатолик бор"));
   assert.equal(f.conversations.length,2);
   await call(f.env,f.textMsg(584002,"/start"));
   assert.equal(f.conversations.length,2);
   assert.equal(f.conversations[0].text,"/start");
   assert.ok(f.conversations.every(x=>!x.text.includes("Lava Pro")));
 }finally{globalThis.fetch=oldFetch;}
});
