import { parseStartCommand, parseStartPayload, telegramLanguage, escapeHtml, limitText, dayKey, isClose, shouldAvoidAi, parseAiDecision } from "./logic.js";
import { COPY, FACTS, menu, explicitFaq } from "./content.js";

const ok = () => new Response("ok", { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
const fail = (status) => new Response("unavailable", { status });

function equalSecret(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function telegram(env, method, params, timeoutMs = 8000) {
  const resp = await fetch("https://api.telegram.org/bot" + env.BOT_TOKEN + "/" + method, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!resp.ok) throw new Error("telegram_http_" + resp.status);
  const body = await resp.json();
  if (!body.ok) throw new Error("telegram_rejected_" + method);
  return body.result;
}

async function sendUser(env, tgId, text, replyMarkup = null) {
  return telegram(env, "sendMessage", {
    chat_id: tgId,
    text,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {})
  });
}

// Telegram displays "typing…" for up to 5 seconds. Keep this best-effort:
 // a failed status request must never stop the user's actual answer.
async function showTyping(env, tgId) {
  try {
    await telegram(env, "sendChatAction", { chat_id: tgId, action: "typing" }, 1800);
  } catch {
    // Typing is optional; don't delay or fail an answer on status errors.
  }
}

async function notifyUser(env, tgId, text) {
  // A blocked chat must not prevent an operator from receiving a ticket.
  try { await sendUser(env, tgId, text); }
  catch { console.warn("support_user_notification_failed"); }
}

async function updateUser(env, tgId, lang, source, now) {
  await env.DB.prepare(
    "INSERT INTO support_users(tg_id,lang,source,updated_at) VALUES(?,?,?,?) " +
    "ON CONFLICT(tg_id) DO UPDATE SET lang=excluded.lang,source=excluded.source,updated_at=excluded.updated_at"
  ).bind(tgId, lang, source, now).run();
}

async function userContext(env, user, startPayload = null) {
  const existing = await env.DB.prepare(
    "SELECT lang,source FROM support_users WHERE tg_id=?"
  ).bind(user.id).first();
  const fromLink = parseStartPayload(startPayload);
  const lang = fromLink?.lang || existing?.lang || telegramLanguage(user.language_code);
  const source = fromLink?.source || existing?.source || "direct";
  await updateUser(env, user.id, lang, source, Math.floor(Date.now() / 1000));
  return { lang, source };
}

async function claimQuota(env, scope, maximum) {
  const result = await env.DB.prepare(
    "INSERT INTO quotas(scope,day,used) VALUES(?,?,1) " +
    "ON CONFLICT(scope,day) DO UPDATE SET used=used+1 WHERE used < ?"
  ).bind(scope, dayKey(), maximum).run();
  return Number(result.meta?.changes || 0) > 0;
}

async function activeTicket(env, userId) {
  return env.DB.prepare(
    "SELECT id,tg_id,lang,source FROM tickets WHERE tg_id=? AND status='open' LIMIT 1"
  ).bind(userId).first();
}

async function openTicket(env, userId, ctx) {
  const now = Math.floor(Date.now() / 1000);
  const inserted = await env.DB.prepare(
    "INSERT OR IGNORE INTO tickets(tg_id,lang,source,status,created_at,updated_at) " +
    "VALUES(?,?,?,'open',?,?)"
  ).bind(userId, ctx.lang, ctx.source, now, now).run();
  const ticket = await activeTicket(env, userId);
  if (!ticket) throw new Error("ticket_missing_after_insert");
  return { ...ticket, isNew: Number(inserted.meta?.changes || 0) > 0 };
}

async function saveAdminLink(env, adminMessageId, ticketId) {
  await env.DB.prepare(
    "INSERT OR REPLACE INTO admin_links(admin_message_id,ticket_id) VALUES(?,?)"
  ).bind(adminMessageId, ticketId).run();
}

async function forwardToOperator(env, user, ctx, message = null) {
  const ticket = await openTicket(env, user.id, ctx);
  const detail = message && (message.text || message.caption) ? limitText(message.text || message.caption, 1300) : "";
  const header = "<b>📨 HSK AI Support #" + ticket.id + "</b>" +
    "\nID: <code>" + user.id + "</code>" +
    "\nLanguage: " + escapeHtml(ctx.lang) +
    "\nSource: " + escapeHtml(ctx.source) +
    "\nName: " + escapeHtml(limitText(user.first_name || "", 60)) +
    "\n\n" + (detail ? escapeHtml(detail) : "👤 Operator requested / media attached");
  const adminMessage = await telegram(env, "sendMessage", {
    chat_id: env.ADMIN_CHAT_ID,
    text: header,
    parse_mode: "HTML"
  });
  await saveAdminLink(env, adminMessage.message_id, ticket.id);
  if (message && !message.text && message.message_id) {
    const forwarded = await telegram(env, "copyMessage", {
      chat_id: env.ADMIN_CHAT_ID,
      from_chat_id: user.id,
      message_id: message.message_id
    });
    await saveAdminLink(env, forwarded.message_id, ticket.id);
  }
  await env.DB.prepare("UPDATE tickets SET updated_at=? WHERE id=?").bind(Math.floor(Date.now() / 1000), ticket.id).run();
  await notifyUser(env, user.id, ticket.isNew ? COPY[ctx.lang].opened : COPY[ctx.lang].active);
}

async function askAi(env, userId, lang, input) {
  if (!env.AI && (!env.AI_API_KEY || !env.AI_MODEL)) return null;
  const endpoint = env.AI_BASE_URL || "https://api.openai.com/v1/chat/completions";
  if (!endpoint.startsWith("https://")) return null;
  if (!await claimQuota(env, "ai-user:" + userId, 3)) return null;
  if (!await claimQuota(env, "ai-global", 60)) return null;
  const system = [
    "You are the minimal HSK AI product support assistant, not a tutor.",
    "Reply only in language code " + lang + ". Write like a helpful human, not an instruction manual.",
    "Use 1 or 2 short sentences, at most 220 characters total. No lists, headings, long explanations or formal introductions.",
    "Ask only one simple follow-up question if needed. Do not use markdown or more than one emoji.",
    "Only the following facts are confirmed:",
    ...FACTS.map((item) => "- " + item),
    "Never invent procedures or details absent from these facts.",
    "If the user's issue needs checking their account, subscription, payment or a bug, hand off.",
    'Output only valid JSON: {"action":"answer","answer":"..."} or {"action":"handoff","answer":""}.'
  ].join("\n");
  await showTyping(env, userId);
  const typingTimer = setInterval(() => { void showTyping(env, userId); }, 4000);
  try {
    if (env.AI) {
      const output = await env.AI.run(
        env.AI_MODEL || "@cf/zai-org/glm-4.7-flash",
        {
          messages: [
            { role: "system", content: system },
            { role: "user", content: limitText(input, 650) }
          ],
          max_tokens: 160,
          temperature: 0.2
        }
      );
      const content = output?.response ?? output?.result?.response ??
        output?.choices?.[0]?.message?.content ?? null;
      const decision = parseAiDecision(content);
      return decision?.action === "answer" ? decision.answer : null;
    }
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "authorization": "Bearer " + env.AI_API_KEY },
      body: JSON.stringify({
        model: env.AI_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: limitText(input, 650) }
        ],
        max_tokens: 160
      }),
      signal: AbortSignal.timeout(6500)
    });
    if (!response.ok) return null;
    const data = await response.json();
    const answer = data?.choices?.[0]?.message?.content;
    const decision = parseAiDecision(answer);
    return decision?.action === "answer" ? decision.answer : null;
  } catch {
    console.warn("support_ai_unavailable");
    return null;
  } finally {
    clearInterval(typingTimer);
  }
}

async function handlePrivate(env, message) {
  const user = message.from;
  if (!user || user.is_bot || message.chat?.id !== user.id) return;
  const start = parseStartCommand(message.text || "");
  const ctx = await userContext(env, user, start);
  const copy = COPY[ctx.lang];
  if (start !== null || message.text === "/help") {
    await sendUser(env, user.id, copy.welcome, menu(ctx.lang));
    return;
  }
  if (!await claimQuota(env, "msg-user:" + user.id, 60)) return;
  if ((message.text || "").trim() === "/operator") {
    await forwardToOperator(env, user, ctx);
    return;
  }
  const ticket = await activeTicket(env, user.id);
  if (ticket) {
    await forwardToOperator(env, user, ctx, message);
    return;
  }
  if (!message.text) {
    await forwardToOperator(env, user, ctx, message);
    return;
  }
  const text = limitText(message.text, 1300);
  if (!text) return;
  const faq = explicitFaq(text, ctx.lang);
  if (faq) {
    await sendUser(env, user.id, faq, menu(ctx.lang));
    return;
  }
  if (shouldAvoidAi(text)) {
    await forwardToOperator(env, user, ctx, message);
    return;
  }
  const answer = await askAi(env, user.id, ctx.lang, text);
  if (answer) {
    await sendUser(env, user.id, answer, {
      inline_keyboard: [[{ text: copy.buttons[3], callback_data: "help:operator" }]]
    });
    return;
  }
  await forwardToOperator(env, user, ctx, message);
}

async function handleCallback(env, callback) {
  if (!callback?.from || callback.from.is_bot || callback.message?.chat?.id !== callback.from.id) return;
  const action = String(callback.data || "");
  if (!["help:payment", "help:account", "help:bug", "help:operator"].includes(action)) return;
  await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id });
  const ctx = await userContext(env, callback.from);
  const copy = COPY[ctx.lang];
  if (!await claimQuota(env, "msg-user:" + callback.from.id, 60)) return;
  if (action === "help:operator") {
    await forwardToOperator(env, callback.from, ctx);
    return;
  }
  const key = action.slice(5);
  await sendUser(env, callback.from.id, copy[key], menu(ctx.lang));
}

async function handleAdmin(env, message) {
  if (String(message.chat?.id) !== String(env.ADMIN_CHAT_ID)) return;
  if (!message.from || message.from.is_bot || !message.reply_to_message?.message_id) return;
  const link = await env.DB.prepare(
    "SELECT a.ticket_id,t.tg_id,t.lang,t.status FROM admin_links a " +
    "JOIN tickets t ON t.id=a.ticket_id WHERE a.admin_message_id=?"
  ).bind(message.reply_to_message.message_id).first();
  if (!link) return;
  if (isClose(message.text)) {
    if (link.status !== "open") return;
    await env.DB.prepare(
      "UPDATE tickets SET status='closed',updated_at=? WHERE id=? AND status='open'"
    ).bind(Math.floor(Date.now() / 1000), link.ticket_id).run();
    await notifyUser(env, link.tg_id, COPY[link.lang]?.closed || COPY.ru.closed);
    await telegram(env, "sendMessage", {
      chat_id: env.ADMIN_CHAT_ID,
      text: "✅ Ticket #" + link.ticket_id + " closed.",
      reply_to_message_id: message.message_id
    });
    return;
  }
  if (link.status !== "open") return;
  await telegram(env, "copyMessage", {
    chat_id: link.tg_id,
    from_chat_id: env.ADMIN_CHAT_ID,
    message_id: message.message_id
  });
  await env.DB.prepare("UPDATE tickets SET updated_at=? WHERE id=?").bind(Math.floor(Date.now() / 1000), link.ticket_id).run();
}

async function routeUpdate(env, update) {
  if (update.callback_query) return handleCallback(env, update.callback_query);
  if (!update.message) return;
  if (String(update.message.chat?.id) === String(env.ADMIN_CHAT_ID)) {
    return handleAdmin(env, update.message);
  }
  if (update.message.chat?.type === "private") return handlePrivate(env, update.message);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") return ok();
    if (request.method !== "POST" || url.pathname !== "/webhook") return fail(404);
    if (!env.BOT_TOKEN || !env.WEBHOOK_SECRET || !env.ADMIN_CHAT_ID || !env.DB) return fail(503);
    if (!equalSecret(env.WEBHOOK_SECRET, request.headers.get("X-Telegram-Bot-Api-Secret-Token"))) return fail(403);
    let update;
    try { update = await request.json(); } catch { return fail(400); }
    if (!Number.isSafeInteger(update?.update_id) || update.update_id < 0) return fail(400);
    const created = await env.DB.prepare(
      "INSERT OR IGNORE INTO processed_updates(update_id,created_at) VALUES(?,?)"
    ).bind(update.update_id, Math.floor(Date.now() / 1000)).run();
    if (!Number(created.meta?.changes || 0)) return ok();
    try {
      await routeUpdate(env, update);
      return ok();
    } catch (error) {
      await env.DB.prepare("DELETE FROM processed_updates WHERE update_id=?").bind(update.update_id).run();
      console.error("support_update_failed", error?.name || "Error");
      return fail(503);
    }
  },
  async scheduled(_controller, env) {
    // No message bodies or card information are stored; prune metadata only.
    const now = Math.floor(Date.now() / 1000);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM processed_updates WHERE created_at < ?").bind(now - 7 * 86400),
      env.DB.prepare("DELETE FROM quotas WHERE day < ?").bind(dayKey(Date.now() - 3 * 86400000)),
      env.DB.prepare("DELETE FROM tickets WHERE updated_at < ?").bind(now - 90 * 86400),
      env.DB.prepare("DELETE FROM admin_links WHERE ticket_id NOT IN (SELECT id FROM tickets)")
    ]);
  }
};
