import test from "node:test";
import assert from "node:assert/strict";
import { parseStartCommand, parseStartPayload, telegramLanguage, escapeHtml, dayKey, isClose, shouldAvoidAi, requiresHumanVerification, parseAiDecision, isUiFeedback } from "../src/logic.js";
import { explicitFaq, menu } from "../src/content.js";

test("Deep links select language and source, reject unexpected values", () => {
  assert.equal(parseStartCommand("/start tj_pwa"), "tj_pwa");
  assert.equal(parseStartCommand("/start@hskai_support_bot ru_ig"), "ru_ig");
  assert.deepEqual(parseStartPayload("uz_android"), { lang: "uz", source: "android" });
  assert.equal(parseStartPayload("ru_admin"), null);
  assert.equal(parseStartPayload("ru_web_extra"), null);
  assert.equal(parseStartCommand("/help"), null);
});
test("Telegram interface fallback and safe HTML", () => {
  assert.equal(telegramLanguage("tg"), "tj");
  assert.equal(telegramLanguage("uz-UZ"), "uz");
  assert.equal(telegramLanguage("en"), "ru");
  assert.equal(escapeHtml('<b x="1">&'), "&lt;b x=&quot;1&quot;&gt;&amp;");
  assert.equal(dayKey(Date.UTC(2026, 10, 6)), "2026-11-06");
});
test("Operator commands and secrets are not sent to AI", () => {
  assert.equal(isClose("/close"), true);
  assert.equal(isClose("/close now"), false);
  assert.equal(shouldAvoidAi("My CVV is 123"), true);
  assert.equal(shouldAvoidAi("Мой пароль не работает"), true);
  assert.equal(shouldAvoidAi("Почему не открывается урок?"), false);
});
test("AI may answer only short valid JSON; otherwise it defers", () => {
  assert.deepEqual(parseAiDecision('{"action":"answer","answer":"Откройте раздел подписки."}'), { action:"answer", answer:"Откройте раздел подписки." });
  assert.deepEqual(parseAiDecision('{"action":"handoff","answer":""}'), { action:"handoff" });
  assert.equal(parseAiDecision("Я всё исправил"), null);
  assert.equal(parseAiDecision('{"action":"answer","answer":"ok"}'), null);
  assert.equal(parseAiDecision('{"action":"answer","answer":123}'), null);
});
test("FAQ and menu are localized", () => {
  assert.match(explicitFaq("подписка", "ru"), /Подписка|Оплата/);
  assert.match(explicitFaq("обуна", "tj"), /Пардохт/);
  assert.match(explicitFaq("тўлов", "uz"), /Тўлов/);
  assert.equal(explicitFaq("непонятный длинный вопрос с деталями о карте", "ru"), null);
  assert.equal(menu("ru").inline_keyboard[1][1].callback_data, "help:operator");
});

test("AI supports a helpful 220-450 character explanation but rejects long monologues", () => {
  assert.equal(parseAiDecision(JSON.stringify({ action: "answer", answer: "а".repeat(221) }))?.answer.length, 221);
  assert.equal(parseAiDecision(JSON.stringify({ action: "answer", answer: "а".repeat(451) })), null);
  assert.deepEqual(
    parseAiDecision(JSON.stringify({ action: "answer", answer: "Да, помогу! Уточните, что не работает." })),
    { action: "answer", answer: "Да, помогу! Уточните, что не работает." }
  );
});


test("V2 high-risk personal payment/account questions require an operator",()=>{
  assert.equal(requiresHumanVerification("Мой чек подтверждает оплату?"),true);
  assert.equal(requiresHumanVerification("Оё чеки ман пардохтро тасдиқ мекунад?"),true);
  assert.equal(requiresHumanVerification("Менинг тўлов чеким тасдиқланганми?"),true);
  assert.equal(requiresHumanVerification("Мой вход не работает, проверьте аккаунт"),true);
  assert.equal(requiresHumanVerification("Аккаунтим очилмаяпти, текшириб беринг"),true);
  assert.equal(requiresHumanVerification("Можно оплатить через Alipay?"),false);
  assert.equal(requiresHumanVerification("Как войти в аккаунт?"),false);
  assert.equal(requiresHumanVerification("Мой вход не работает"),false);
  assert.equal(requiresHumanVerification("Менда аккаунтга кириш ишламаяпти"),false);
  assert.equal(requiresHumanVerification("HSK AI нима?"),false);
});

test("V2 generic sign-in questions get safe localized FAQ instead of invented steps",()=>{
  assert.match(explicitFaq("Как войти в аккаунт?","ru"),/Аккаунт и вход/);
  assert.match(explicitFaq("Чӣ тавр ба аккаунт дароям?","tj"),/Ҳисоб ва воридшавӣ/);
  assert.match(explicitFaq("Аккаунтга қандай кираман?","uz"),/Аккаунтга кириш/);
});

test("visual feedback identifies UX criticisms but not personal payment checks",()=>{
  assert.equal(isUiFeedback("интерфейс не очень хороший"),true);
  assert.equal(isUiFeedback("Дизайн ужасный"),true);
  assert.equal(isUiFeedback("Интерфейс жуда ноқулай"),true);
  assert.equal(isUiFeedback("Дизайн ва кўриниш яхши эмас"),true);
  assert.equal(isUiFeedback("Мой платеж не прошел"),false);
  assert.equal(isUiFeedback("Как войти в аккаунт?"),false);
  assert.equal(isUiFeedback("Как открыть интерфейс оплаты?"),false);
});

test("AI report JSON validates classification and factual summary",()=>{
  const x={action:"report",kind:"bug",answer:"Похоже на сбой. Уточните модель телефона.",summary:"Приложение закрывается сразу после открытия урока."};
  assert.deepEqual(parseAiDecision(JSON.stringify(x)),x);
  assert.equal(parseAiDecision(JSON.stringify({...x,kind:"account_takeover"})),null);
  assert.equal(parseAiDecision(JSON.stringify({...x,summary:"ok"})),null);
  assert.equal(parseAiDecision(JSON.stringify({...x,answer:"ok"})),null);
  assert.equal(parseAiDecision(JSON.stringify({...x,summary:"x".repeat(241)})),null);
});
