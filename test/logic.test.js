import test from "node:test";
import assert from "node:assert/strict";
import { parseStartCommand, parseStartPayload, telegramLanguage, escapeHtml, dayKey, isClose, shouldAvoidAi, parseAiDecision } from "../src/logic.js";
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
