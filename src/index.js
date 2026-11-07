import { parseStartCommand, parseStartPayload, telegramLanguage, escapeHtml, limitText, dayKey, isClose, shouldAvoidAi, requiresHumanVerification, isUiFeedback, isExplicitScreenshotError } from "./logic.js";
import { COPY, explicitFaq } from "./content.js";
import { generateSupportAnswer, AI_NO_FACTS } from "./ai.js";
import { saveConversationExchange, clearConversationContext, sanitizeConversationText } from "./conversation.js";
import { detectReplyLanguage, conversationalFallback } from "./language.js";
import { hasHoldableImage, holdImageForCaption, claimImageForText, claimImageFromQueue,
  restoreTelegramImageMessage, finishPendingImage, releasePendingImage, cancelPendingImages } from "./pending-image.js";

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
    // Keep URLs clickable, but prevent large Telegram link preview cards.
    link_preview_options: { is_disabled: true },
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

async function claimQuota(env, scope, maximum, period = dayKey()) {
  const result = await env.DB.prepare(
    "INSERT INTO quotas(scope,day,used) VALUES(?,?,1) " +
    "ON CONFLICT(scope,day) DO UPDATE SET used=used+1 WHERE used < ?"
  ).bind(scope, period, maximum).run();
  return Number(result.meta?.changes || 0) > 0;
}

async function ticketForUser(env, userId) {
  return env.DB.prepare(
    "SELECT id,tg_id,lang,source FROM tickets WHERE tg_id=? AND status='open' LIMIT 1"
  ).bind(userId).first();
}

async function activeTicket(env, userId) {
  const ticket=await ticketForUser(env,userId);
  // AI triage reports are kept open for operator replies, NOT a full live-chat takeover.
  return ticket?.source==="ai_report" ? null : ticket;
}

async function openTicket(env, userId, ctx) {
  const now = Math.floor(Date.now() / 1000);
  const previous=await ticketForUser(env,userId);
  if (previous?.source==="ai_report" && ctx.source!=="ai_report") {
    // An explicit /operator upgrades an existing AI report to human chat mode.
    const changed=await env.DB.prepare(
      "UPDATE tickets SET source=?,updated_at=? WHERE id=? AND source='ai_report' AND status='open'"
    ).bind(ctx.source,now,previous.id).run();
    if(Number(changed.meta?.changes||0)>0) return {...previous,source:ctx.source,isNew:false,upgraded:true};
  }
  const inserted = await env.DB.prepare(
    "INSERT OR IGNORE INTO tickets(tg_id,lang,source,status,created_at,updated_at) " +
    "VALUES(?,?,?,'open',?,?)"
  ).bind(userId, ctx.lang, ctx.source, now, now).run();
  const ticket = await ticketForUser(env, userId);
  if (!ticket) throw new Error("ticket_missing_after_insert");
  return { ...ticket, isNew: Number(inserted.meta?.changes || 0) > 0 };
}

async function saveAdminLink(env, adminMessageId, ticketId) {
  await env.DB.prepare(
    "INSERT OR REPLACE INTO admin_links(admin_message_id,ticket_id) VALUES(?,?)"
  ).bind(adminMessageId, ticketId).run();
}

// One compact ticket card on open. Subsequent messages are copied as-is,
// so the operator sees the actual user message without repetitive metadata.
async function forwardToOperator(env, user, ctx, message = null) {
  if (!env.ADMIN_CHAT_ID) {
    await notifyUser(env, user.id, (COPY[ctx.lang] || COPY.ru).operatorUnavailable);
    return;
  }
  const ticket = await openTicket(env, user.id, ctx);
  const detail = message && (message.text || message.caption) ?
    limitText(message.text || message.caption, 1300) : "";
  if (ticket.isNew || ticket.upgraded) {
    const username = /^[A-Za-z0-9_]{3,32}$/.test(String(user.username || "")) ?
      user.username : null;
    const displayName = username ? "@" + username : limitText(user.first_name || "User", 60);
    const link = username ? "https://t.me/" + username : "tg://user?id=" + user.id;
    const label = '<a href="' + link + '"><b>' + escapeHtml(displayName) + '</b></a>';
    const requestText = detail || (message && !message.text ? "📎 Медиа" : "Оператор керак");
    const header = "👤 " + label + " · <code>" + escapeHtml(ctx.lang) + "</code>" +
      "\n<code>/close</code>" +
      "\n\n<blockquote>" + escapeHtml(requestText) + "</blockquote>";
    const adminMessage = await telegram(env, "sendMessage", {
      chat_id: env.ADMIN_CHAT_ID,
      text: header,
      parse_mode: "HTML"
    });
    await saveAdminLink(env, adminMessage.message_id, ticket.id);
  }
  // Media must be copied to preserve the actual photo/document. For an
  // existing ticket, copy every new message without creating another header.
  if (message?.message_id && (!ticket.isNew || !message.text)) {
    const copied = await telegram(env, "copyMessage", {
      chat_id: env.ADMIN_CHAT_ID,
      from_chat_id: user.id,
      message_id: message.message_id
    });
    await saveAdminLink(env, copied.message_id, ticket.id);
  }
  await env.DB.prepare("UPDATE tickets SET updated_at=? WHERE id=?")
    .bind(Math.floor(Date.now() / 1000), ticket.id).run();
  // Notify only when the ticket is first opened. Follow-up user messages
  // are silently copied to the operator, without "message delivered" spam.
  if (ticket.isNew || ticket.upgraded) {
    await notifyUser(env, user.id, (COPY[ctx.lang] || COPY.ru).opened);
  }
}


// AI alone decides whether the user described a plausible defect or actionable feedback.
// Send a redacted summary and, when Vision explicitly clears the image, the
// exact Telegram screenshot. Sensitive/uncertain images are not forwarded.
async function forwardAiReport(env, user, ctx, report, message) {
  if (!env.ADMIN_CHAT_ID || !["bug","feedback"].includes(report.kind)) return false;
  const summary=sanitizeConversationText(report.summary);
  if (!summary || shouldAvoidAi(report.summary)) return false;
  const original=sanitizeConversationText(message.text || message.caption || "");
  if(shouldAvoidAi(message.caption||"") || requiresHumanVerification(message.caption||"")) return false;
  // Every genuine AI-classified report can reach the operator. A per-user
  // 3/day quota previously consumed slots even when delivery failed, causing
  // legitimate crash/UX reports to be silently rejected during E2E testing.
  // Telegram webhook update-id deduplication still blocks delivery retries.
  const ticket=await openTicket(env,user.id,{...ctx,source:"ai_report"});
  if(ticket.source!=="ai_report") return false;
  const username=/^[A-Za-z0-9_]{3,32}$/.test(String(user.username||"")) ? user.username : null;
  const who=username ? "@"+username : limitText(user.first_name||"User",60);
  const url=username ? "https://t.me/"+username : "tg://user?id="+user.id;
  const isImage=Boolean(message.photo?.length||message.document);
  const classification=report.kind==="bug" ? "🐛 Possible defect" : "💡 Product feedback";
  const header=classification+" · AI triage\n👤 <a href=\""+url+"\"><b>"+escapeHtml(who)+
    "</b></a> · <code>"+escapeHtml(ctx.lang)+"</code> · "+escapeHtml(ctx.source)+
    "\n<code>/close</code>\n\n<blockquote>"+escapeHtml(summary)+"</blockquote>"+
    (original ? "\nUser: "+escapeHtml(original.slice(0,300)) : "")+
    (isImage ? "\n📷 Screenshot follows this report when Telegram delivery succeeds." : "");
  let stage="operator_send";
  try {
    const sent=await telegram(env,"sendMessage",{
      chat_id:env.ADMIN_CHAT_ID,text:header,parse_mode:"HTML",link_preview_options:{is_disabled:true}
    });
    stage="operator_reply_link";
    await saveAdminLink(env,sent.message_id,ticket.id);
    let imageSent=!isImage;
    // The screenshot was voluntarily submitted to this support conversation
    // as evidence of the issue. Copy the ORIGINAL message to the private
    // specialist group; never rely on the AI's optional privacy boolean.
    // Credential/payment-proof text is blocked before entering this path.
    if(isImage && message.message_id) {
      try {
        const copied=await telegram(env,"copyMessage",{
          chat_id:env.ADMIN_CHAT_ID,from_chat_id:user.id,message_id:message.message_id
        });
        await saveAdminLink(env,copied.message_id,ticket.id);
        imageSent=true;
      } catch {
        imageSent=false;
        console.warn("support_ai_screenshot_forward_failed");
      }
    }
    stage="ticket_update";
    await env.DB.prepare("UPDATE tickets SET updated_at=? WHERE id=?")
      .bind(Math.floor(Date.now()/1000),ticket.id).run();
    return {sent:true,imageSent};
  } catch (error) {
    // Log the failed delivery stage and safe error code, never the user
    // message, token, chat ID or private payload.
    const code=String(error?.message||"");
    const safeCode=/^telegram_(?:http_\d{3}|rejected_[A-Za-z]+)$/.test(code) ? code : "internal_error";
    console.warn("support_ai_report_delivery_failed",stage,safeCode);
    // A fresh empty auto-ticket should not block the next legitimate report.
    if(ticket.isNew) {
      try {
        await env.DB.prepare("UPDATE tickets SET status='closed',updated_at=? WHERE id=? AND status='open'")
          .bind(Math.floor(Date.now()/1000),ticket.id).run();
      } catch {}
    }
    return false;
  }
}

async function replyToAiReport(env,user,ctx,message,report) {
  const delivery=await forwardAiReport(env,user,ctx,report,message);
  const copy=COPY[ctx.lang]||COPY.ru;
  const isImage=Boolean(message.photo?.length||message.document);
  // Avoid claims of success until Telegram confirms the operator message.
  const lead=typeof report.answer==="string"&&report.answer.trim()?report.answer.trim()+"\n":"";
  const finalText=delivery?.sent ?
    lead+(report.kind==="bug"?copy.bugReportSent:copy.reportSent)+
      (isImage && !delivery.imageSent ? "\n"+copy.reportImageNotSent : "") :
    copy.reportFailed;
  await sendUser(env,user.id,finalText);
  // A reported IMAGE was previously omitted from the dialogue history.
  // Preserve only a sanitized textual description and our actual response,
  // never the image bytes, Telegram file ID, email, or other private evidence.
  // This lets "it still doesn't work" refer to the error just reported.
  const memoryInput=isImage ?
    ("Reported HSK AI "+report.kind+": "+(report.summary||message.caption||"")) :
    (message.text||"");
  // Keep the *verified* delivery result at the START of the saved assistant
  // turn. Otherwise a 300+ character AI explanation can push the specialist
  // acknowledgment beyond the existing 350-character memory boundary.
  const memoryAnswer=isImage && delivery?.sent ?
    (report.kind==="bug"?copy.bugReportSent:copy.reportSent)+" "+(report.answer||"") :
    finalText;
  await saveConversationExchange(env,user.id,memoryInput,memoryAnswer);
}

async function telegramImage(env, message) {
  const photo = Array.isArray(message.photo) ? message.photo.at(-1) : null;
  const doc = message.document;
  const target = photo || (doc && ["image/jpeg","image/png"].includes(doc.mime_type) ? doc : null);
  if (!target?.file_id || Number(target.file_size||0) > 3_500_000) return null;
  const file = await telegram(env,"getFile",{file_id:target.file_id},5000);
  const path = String(file?.file_path || "");
  if (!/^[A-Za-z0-9_./-]{1,240}$/.test(path) || path.includes("..") ||
      Number(file?.file_size||0)>3_500_000) return null;
  const result=await fetch("https://api.telegram.org/file/bot"+env.BOT_TOKEN+"/"+path,{
    signal:AbortSignal.timeout(6000)
  });
  if(!result.ok) return null;
  const contentLength=Number(result.headers.get("content-length") || 0);
  if(contentLength > 3_500_000) return null;
  const bytes=new Uint8Array(await result.arrayBuffer());
  if(!bytes.length||bytes.length>3_500_000) return null;
  // Use the actual image header rather than arbitrary user supplied MIME.
  const jpeg=bytes[0]===0xff && bytes[1]===0xd8 && bytes[2]===0xff;
  const png=bytes[0]===0x89 && bytes[1]===0x50 && bytes[2]===0x4e && bytes[3]===0x47;
  if(!jpeg&&!png) return null;
  let binary="";
  for(let i=0;i<bytes.length;i+=16384) binary+=String.fromCharCode(...bytes.slice(i,i+16384));
  return "data:image/"+(jpeg?"jpeg":"png")+";base64,"+btoa(binary);
}

async function askAi(env, userId, lang, input, imageDataUrl = null) {
  if (!env.AI && !(env.AI_API_KEY && env.AI_MODEL)) return null;
  await showTyping(env,userId);
  const typingTimer=setInterval(()=>{void showTyping(env,userId);},4000);
  try {
    return await generateSupportAnswer(env,{userId,lang,input,imageDataUrl,claimQuota});
  } catch {
    console.warn("support_ai_unavailable");
    return null;
  } finally {
    clearInterval(typingTimer);
  }
}

async function returnToBotMenu(env, user) {
  // Explicit /start exits the old operator conversation so new questions
  // return to FAQ/AI rather than silently forwarding everything to admin.
  const ticket = await activeTicket(env, user.id);
  if (!ticket) return;
  const result = await env.DB.prepare(
    "UPDATE tickets SET status='closed',updated_at=? WHERE id=? AND status='open'"
  ).bind(Math.floor(Date.now()/1000), ticket.id).run();
  if (!Number(result.meta?.changes || 0) || !env.ADMIN_CHAT_ID) return;
  const name = /^[A-Za-z0-9_]{3,32}$/.test(String(user.username || "")) ?
    "@" + user.username : limitText(user.first_name || "User", 60);
  try {
    await telegram(env,"sendMessage",{
      chat_id:env.ADMIN_CHAT_ID,
      text:"↩️ " + name + " вернулся к боту. Обращение закрыто."
    });
  } catch { console.warn("support_operator_exit_notice_failed"); }
}

// Shared Vision pipeline for captioned media, delayed bare media and joined
// screenshot+text. Operator reports retain the original Telegram image id.
async function answerAboutImage(env,user,ctx,message,caption) {
  const copy=COPY[ctx.lang]||COPY.ru;
    // Keep sensitive payment proofs and credential photos within human support.
    // Sensitive receipts and personal account status require human consent;
    // never automatically send these files to the operator.
    if (shouldAvoidAi(caption) || /чек|receipt|bank\\s*card|карта\\s*банк|платёжн(?:ый|ая)\\s*документ/iu.test(caption)) {
      await sendUser(env,user.id,copy.sensitive);
      return;
    }
    if (requiresHumanVerification(caption)) {
      await sendUser(env,user.id,copy.accountCheck);
      return;
    }
    let image=null;
    try {image=await telegramImage(env,message);} catch {image=null;}
    if (!image) {
      await sendUser(env,user.id,copy.mediaHelp);
      return;
    }
    const answer=await askAi(env,user.id,ctx.lang,caption || "HSK AI screenshot",image);
    if(answer?.action==="report") {
      await replyToAiReport(env,user,ctx,message,answer);
      return;
    }
    if(isExplicitScreenshotError(caption)) {
      // Don't let a model's "answer" classification hide a clearly described
      // product failure from specialists. Use its natural advice if available.
      const summary=sanitizeConversationText(caption).slice(0,220);
      if(summary.length>=12 && !shouldAvoidAi(summary)){
        await replyToAiReport(env,user,ctx,message,{
          action:"report",kind:"bug",summary,
          answer:typeof answer==="string"?answer:""
        });
        return;
      }
    }
    if(answer===AI_NO_FACTS) {
      await sendUser(env,user.id,isUiFeedback(caption)?copy.uiFeedbackAck:copy.noKnowledge);
      return;
    }
    if(typeof answer==="string" && answer) {
      await sendUser(env,user.id,answer);
      // Image-only and image+caption answers must also be available to the
      // next text turn. saveConversationExchange sanitizes both fields.
      await saveConversationExchange(env,user.id,caption||"User sent HSK AI screenshot",answer);
      return;
    }
    // The photo loaded. AI uncertainty must never be called a broken file.
    await sendUser(env,user.id,isUiFeedback(caption) ? copy.uiFeedbackAck : copy.imageAnalysisUnavailable);
    return;
}

// An explicit operator request while a screenshot is pending must preserve
// the user's uploaded image: forward the original Telegram message to the
// human chat instead of silently dropping it or running delayed Vision.
async function openOperatorWithPendingImage(env,user,ctx) {
  const pending=env.IMAGE_DELAY_QUEUE ? await claimImageForText(env,user.id) : null;
  try{
    await forwardToOperator(env,user,ctx);
    if(pending) {
      await forwardToOperator(env,user,ctx,restoreTelegramImageMessage(pending));
      await finishPendingImage(env,pending);
    }
    await cancelPendingImages(env,user.id);
  }catch(error){
    if(pending)try{await releasePendingImage(env,pending);}catch{}
    throw error;
  }
}

async function handlePrivate(env, message) {
  const user = message.from;
  if (!user || user.is_bot || message.chat?.id !== user.id) return;
  const start = parseStartCommand(message.text || "");
  const ctx = await userContext(env, user, start);
  // No language picker: infer from each message and persist for short follow-ups.
  // Deep-link locale is only the fallback for an ambiguous message.
  if (start === null) {
    const detected = detectReplyLanguage(ctx.lang, message.text || message.caption || "");
    if (detected !== ctx.lang) {
      await updateUser(env, user.id, detected, ctx.source, Math.floor(Date.now()/1000));
      ctx.lang = detected;
    }
  }
  const copy = COPY[ctx.lang] || COPY.ru;
  if (start !== null) {
    await cancelPendingImages(env,user.id);
    await returnToBotMenu(env, user);
    await clearConversationContext(env,user.id);
    await sendUser(env, user.id, copy.welcome);
    // /start is visible to the next AI turn without being another chat message.
    await saveConversationExchange(env,user.id,"/start",
      "HSK AI Support chat started. User may describe an issue or send a screenshot.");
    return;
  }
  if (message.text === "/help") {
    await cancelPendingImages(env,user.id);
    await sendUser(env, user.id, copy.help);
    return;
  }
  if ((message.text || "").trim() === "/operator") {
    await openOperatorWithPendingImage(env,user,ctx);
    return;
  }
  const ticket = await activeTicket(env, user.id);
  if (ticket) {
    await forwardToOperator(env, user, ctx, message);
    return;
  }
  if (!message.text && (message.photo?.length || message.document)) {
    const caption=limitText(message.caption || "",1300);
    // Bare screenshots wait for a possible explanation. A photo that already
    // carries a caption is interpreted immediately, as before.
    if(!caption && hasHoldableImage(message) &&
       await holdImageForCaption(env,message,ctx)) return;
    await answerAboutImage(env,user,ctx,message,caption);
    return;
  }
  if (!message.text) {
    await sendUser(env,user.id,copy.mediaHelp);
    return;
  }
  const text = limitText(message.text, 1300);
  if (!text) return;
  if (requiresHumanVerification(text) || shouldAvoidAi(text)) {
    // A personal payment, card or credential message cannot be sent to
    // Vision alongside a screenshot. Cancel only the pending photo(s).
    await cancelPendingImages(env,user.id);
    await sendUser(env,user.id,requiresHumanVerification(text)?copy.accountCheck:copy.sensitive);
    return;
  }
  // When an explanation arrives during the 60s window, atomically claim
  // the most recent bare screenshot. The delayed queue copy becomes a no-op.
  const pending=env.IMAGE_DELAY_QUEUE ? await claimImageForText(env,user.id) : null;
  if(pending){
    const media=restoreTelegramImageMessage(pending,text);
    try{
      await answerAboutImage(env,user,ctx,media,text);
      await finishPendingImage(env,pending);
    }catch(error){
      await releasePendingImage(env,pending);
      throw error;
    }
    return;
  }
  const faq = explicitFaq(text, ctx.lang);
  if (faq) {
    await sendUser(env, user.id, faq);
    // Keep account/login topic for the next one-word platform reply.
    // Existing short-lived D1 memory is reused; no new table or external call.
    await clearConversationContext(env,user.id);
    await saveConversationExchange(env,user.id,
      "FAQ selected by user: "+text, "Selected support topic: "+(
        faq===copy.account?"Account and sign-in":faq===copy.payment?"Pro subscription payment":"Technical issue"
      ));
    return;
  }
  const answer = await askAi(env, user.id, ctx.lang, text);
  if (answer===AI_NO_FACTS) {
    await sendUser(env,user.id,copy.noKnowledge);
    return;
  }
  if (answer?.action==="report") {
    await replyToAiReport(env,user,ctx,message,answer);
    return;
  }
  if (typeof answer==="string" && answer) {
    await sendUser(env, user.id, answer);
    return;
  }
  if (isUiFeedback(text)) {
    await sendUser(env, user.id, copy.uiFeedbackAck);
    return;
  }
  // Greetings and language requests never need R2 or an operator. They also
  // remain useful when AI is unavailable.
  const conversational = conversationalFallback(text, ctx.lang);
  if (conversational) {
    await sendUser(env, user.id, conversational);
    return;
  }
  // Missing R2 knowledge or model uncertainty is not consent
  // to open an operator ticket.
  await sendUser(env, user.id, copy.unavailable);
}

async function handleCallback(env, callback) {
  if (!callback?.from || callback.from.is_bot || callback.message?.chat?.id !== callback.from.id) return;
  const action = String(callback.data || "");
  if (!["help:payment", "help:account", "help:bug", "help:operator"].includes(action)) return;
  await telegram(env, "answerCallbackQuery", { callback_query_id: callback.id });
  const ctx = await userContext(env, callback.from);
  const copy = COPY[ctx.lang];
  if (action === "help:operator") {
    await openOperatorWithPendingImage(env,callback.from,ctx);
    return;
  }
  const key = action.slice(5);
  await cancelPendingImages(env,callback.from.id);
  await clearConversationContext(env,callback.from.id);
  // The FAQ click is context for AI, not a new canned Telegram message.
  const selected={payment:"Pro subscription payment",account:"Account and sign-in",
    bug:"Technical issue"};
  await saveConversationExchange(env,callback.from.id,
    "FAQ selected: "+key, "Selected support topic: "+selected[key]);

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
    await notifyUser(env, link.tg_id, (COPY[link.lang] || COPY.ru).closed);
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


async function registerWebhookOnce(env, verify = false) {
  if (!env.BOT_TOKEN || !env.WEBHOOK_SECRET || !env.DB) return { status: "missing_configuration" };
  const origin = String(env.PUBLIC_WORKER_ORIGIN || "").replace(/\/+$/, "");
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(origin)) return { status: "invalid_origin" };
  const url = origin + "/webhook";
  const input = new TextEncoder().encode([env.BOT_TOKEN, env.WEBHOOK_SECRET, url].join(":"));
  const fingerprint = [...new Uint8Array(await crypto.subtle.digest("SHA-256", input))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  const previous = await env.DB.prepare(
    "SELECT value FROM service_settings WHERE key='telegram_webhook_sha256'"
  ).first();
  if (previous?.value === fingerprint) {
    if (!verify) return { status: "registered" };
    try {
      const info = await telegram(env, "getWebhookInfo", {});
      if (info?.url === url) {
        return {
          status: "registered",
          pending_updates: Number(info.pending_update_count || 0),
          delivery_error: Boolean(info.last_error_message),
          last_error_at: info.last_error_date || null
        };
      }
      // If another process replaced the webhook, register our fixed endpoint again.
    } catch (error) {
      return {
        status: /^telegram_http_(401|403|404)$/.test(String(error?.message || "")) ?
          "invalid_telegram_token" : "verification_failed"
      };
    }
  }

  // Registration is always for our fixed URL. Block repeated public activation attempts.
  const now = Math.floor(Date.now() / 1000);
  const claim = await env.DB.prepare(
    "INSERT INTO service_settings(key,value,updated_at) VALUES('webhook_last_attempt','1',?) " +
    "ON CONFLICT(key) DO UPDATE SET value='1',updated_at=excluded.updated_at " +
    "WHERE updated_at <= ?"
  ).bind(now, now - 60).run();
  if (!Number(claim.meta?.changes || 0)) return { status: "retry_later" };

  let status = "failed";
  try {
    const me = await telegram(env, "getMe", {});
    if (!me?.username) throw new Error("telegram_getMe_missing_username");
    const result = await telegram(env, "setWebhook", {
      url,
      secret_token: env.WEBHOOK_SECRET,
      max_connections: 1,
      allowed_updates: ["message", "callback_query"]
    });
    if (result !== true) throw new Error("telegram_webhook_not_confirmed");
    await env.DB.prepare(
      "INSERT INTO service_settings(key,value,updated_at) VALUES('telegram_webhook_sha256',?,?) " +
      "ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at"
    ).bind(fingerprint, now).run();
    status = "registered";
    console.info("support_webhook_registered");
  } catch (error) {
    const message = String(error?.message || "");
    status = /^telegram_http_(401|403|404)$/.test(message) ?
      "invalid_telegram_token" : /^telegram_http_/.test(message) ?
      "telegram_http_error" : "registration_failed";
    console.warn("support_webhook_registration_unavailable", status);
  }
  await env.DB.prepare(
    "INSERT INTO service_settings(key,value,updated_at) VALUES('webhook_status',?,?) " +
    "ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at"
  ).bind(status, now).run();
  return { status };
}

// Remove legacy global/private command lists once. Telegram may still
// render a native Menu icon; clients decide the final appearance.
async function removeLegacyBotMenusOnce(env) {
  const key="support_commands_hidden_v1";
  try {
    const previous=await env.DB.prepare(
      "SELECT value FROM service_settings WHERE key='"+key+"'"
    ).first();
    if(previous?.value==="1")return;
    for(const scope of [{type:"default"},{type:"all_private_chats"}]) {
      for(const language_code of [null,"ru","tg","uz"]) {
        await telegram(env,"deleteMyCommands",{
          scope,...(language_code?{language_code}:{})
        },3000);
      }
    }
    await telegram(env,"setChatMenuButton",{menu_button:{type:"default"}},3000);
    const now=Math.floor(Date.now()/1000);
    await env.DB.prepare(
      "INSERT INTO service_settings(key,value,updated_at) VALUES('"+key+"',?,?) "+
      "ON CONFLICT(key) DO UPDATE SET value='1',updated_at=excluded.updated_at"
    ).bind("1",now).run();
  }catch(error) {
    console.warn("support_command_menu_cleanup_failed",error?.name||"Error");
  }
}

async function handleGroupChatId(env, message) {
  if (!message?.from || message.from.is_bot) return;
  if (!["group", "supergroup"].includes(message.chat?.type)) return;
  if (!/^\/chatid(?:@[A-Za-z0-9_]+)?\s*$/i.test(String(message.text || ""))) return;
  // Chat IDs are only returned when the sender is an administrator or owner.
  const member = await telegram(env, "getChatMember", {
    chat_id: message.chat.id,
    user_id: message.from.id
  });
  if (!["administrator", "creator"].includes(member?.status)) return;
  await telegram(env, "sendMessage", {
    chat_id: message.chat.id,
    reply_to_message_id: message.message_id,
    text: "🔐 Operator group chat ID:\n" + String(message.chat.id) +
      "\n\nStore this as ADMIN_CHAT_ID in Cloudflare Worker Secrets."
  });
}

async function routeUpdate(env, update) {
  if (update.callback_query) return handleCallback(env, update.callback_query);
  if (update.message?.chat?.type === "group" || update.message?.chat?.type === "supergroup") {
    if (/^\/chatid(?:@[A-Za-z0-9_]+)?\s*$/i.test(String(update.message.text || ""))) {
      return handleGroupChatId(env, update.message);
    }
  }
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
    if (request.method === "GET" && url.pathname === "/activate") {
      try {
        const result = await registerWebhookOnce(env, true);
        return Response.json({ ...result, webhook: "/webhook", credentials_visible: false },
          { headers: { "cache-control": "no-store" } });
      } catch {
        return Response.json({ status: "temporary_error" }, { status: 503 });
      }
    }
    if (request.method !== "POST" || url.pathname !== "/webhook") return fail(404);
    if (!env.BOT_TOKEN || !env.WEBHOOK_SECRET || !env.DB) return fail(503);
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
  async queue(batch,env) {
    for(const item of batch.messages){
      let row=null;
      try{
        const result=await claimImageFromQueue(env,item.body);
        if(result.status==="missing"||result.status==="invalid"){
          item.ack();continue;
        }
        if(result.status==="early"||result.status==="busy"){
          item.retry({delaySeconds:result.delaySeconds||20});continue;
        }
        row=result.row;
        const user={id:row.tg_id};
        const ctx={lang:row.lang,source:row.source};
        const message=restoreTelegramImageMessage(row);
        // Explicit human-chat mode must not be overridden by queued AI work.
        const ticket=await activeTicket(env,row.tg_id);
        if(ticket)await forwardToOperator(env,user,ctx,message);
        else await answerAboutImage(env,user,ctx,message,"");
        await finishPendingImage(env,row);
        item.ack();
      }catch(error){
        if(row){
          try{await releasePendingImage(env,row);}catch{}
        }
        console.warn("support_pending_image_queue_failed",error?.name||"Error");
        item.retry({delaySeconds:30});
      }
    }
  },
  async scheduled(controller, env) {
    if (controller.cron === "*/5 * * * *") {
      await registerWebhookOnce(env);
      await removeLegacyBotMenusOnce(env);
      // Context must expire close to the one-hour TTL; daily prune is too late.
      try {
        await env.DB.prepare("DELETE FROM ai_conversation WHERE created_at < ?")
          .bind(Math.floor(Date.now()/1000)-3600).run();
      } catch {
        // Schema migration is deployed separately; don't break the webhook cron.
      }
      // Minimize how long Telegram photo references remain in D1 if delivery
      // failed repeatedly. Successful work deletes them immediately.
      try {
        await env.DB.prepare("DELETE FROM pending_images WHERE created_at < ?")
          .bind(Math.floor(Date.now()/1000)-900).run();
      } catch {
        // Rolling back to pre-migration D1 must not block webhook maintenance.
      }
      return;
    }
    if (controller.cron === "0 3 * * *") {
      // No message bodies or card information are stored; prune metadata only.
      const now = Math.floor(Date.now() / 1000);
      await env.DB.batch([
        env.DB.prepare("DELETE FROM processed_updates WHERE created_at < ?").bind(now - 7 * 86400),
        env.DB.prepare("DELETE FROM quotas WHERE length(day)=10 AND day < ?").bind(dayKey(Date.now() - 3 * 86400000)),
        env.DB.prepare("DELETE FROM quotas WHERE length(day)=7 AND day < ?").bind(new Date(Date.now() - 62 * 86400000).toISOString().slice(0,7)),
        env.DB.prepare("DELETE FROM ai_conversation WHERE created_at < ?").bind(now - 3600),
        env.DB.prepare("DELETE FROM pending_images WHERE created_at < ?").bind(now - 86400),
        env.DB.prepare("DELETE FROM tickets WHERE updated_at < ?").bind(now - 90 * 86400),
        env.DB.prepare("DELETE FROM admin_links WHERE ticket_id NOT IN (SELECT id FROM tickets)")
      ]);
    }
  }
};
