import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

function stub() {
  const calls = [], processed = new Set(), users = new Map(), tickets = new Map(), links = new Map(), quotas = new Map();
  let nextTicket = 1;
  const DB = { prepare(sql) { return { bind(...args) { return {
    async run() {
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
    async first() {
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
    env: { DB, BOT_TOKEN: "fake_token", WEBHOOK_SECRET: "secret", ADMIN_CHAT_ID: "-100234", AI_MODEL: "fake" },
    calls, users, tickets, links
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

test("without AI key, user escalation and operator reply both work", async () => {
  const { env, calls, tickets, links } = stub();
  let id = 400;
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    calls.push(JSON.parse(init.body));
    return Response.json({ ok: true, result: { message_id: id++ } });
  };
  try {
    const user = { update_id: 200, message: { chat: { id: 51, type: "private" }, from: { id: 51, language_code: "ru", first_name: "Test" }, message_id: 55, text: "У меня пропала подписка" } };
    assert.equal((await call(env, user)).status, 200);
    assert.equal(tickets.size, 1);
    assert.equal(calls[0].chat_id, "-100234");
    assert.equal(links.get(400), 1);
    assert.equal(calls[1].chat_id, 51);
    const admin = { update_id: 201, message: { chat: { id: -100234, type: "supergroup" }, from: { id: 77 }, message_id: 999, text: "Уточните дату", reply_to_message: { message_id: 400 } } };
    assert.equal((await call(env, admin)).status, 200);
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
  env.AI_MODEL = "@cf/zai-org/glm-4.7-flash";
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
    assert.equal(aiCalls[0].model, "@cf/zai-org/glm-4.7-flash");
    assert.ok(calls.some(x => x.method === "sendMessage" && x.body.text === "HSK AI помогает учить китайский язык."));
    assert.equal(calls.filter(x=>x.method==="sendMessage").length, 1);
  } finally { globalThis.fetch = original; }
});

