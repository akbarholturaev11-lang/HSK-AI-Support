import test from "node:test";
import assert from "node:assert/strict";
import { selectTopics } from "../src/knowledge.js";

// 10 realistic support topics x RU/TJ/UZ. This checks deterministic routing only;
// real model language quality and live payment flows require separate integration QA.
const cases = [
  { topic:"payments", ru:"Почему не прошла оплата?", tj:"Чаро пардохт нашуд?", uz:"Нега тўлов ўтмади?" },
  { topic:"subscriptions", ru:"Подписка на месяц", tj:"Обуна барои як моҳ", uz:"Бир ойлик обуна нархи" },
  { topic:"accounts", ru:"Не работает вход в аккаунт", tj:"Воридшавӣ ба ҳисоб", uz:"Аккаунтга кириш муаммо" },
  { topic:"android", ru:"Android приложение не открывается", tj:"Android барнома кор намекунад", uz:"Android илова очилмайди" },
  { topic:"pwa", ru:"Как открыть PWA на iPhone?", tj:"PWA дар iPhone чӣ тавр?", uz:"PWA ни iPhone да қандай очаман?" },
  { topic:"telegram", ru:"Телеграм бот не работает", tj:"Боти Telegram кор намекунад", uz:"Телеграм бот ишламаяпти" },
  { topic:"general", ru:"Что за курс китайского языка?", tj:"Дарси чинӣ дар куҷост?", uz:"Хитой тилини ўрганиш дарси" },
  { topic:"general", ru:"Что такое HSK AI?", tj:"HSK AI чист?", uz:"HSK AI нима?" },
  { topic:"subscriptions", ru:"Какая цена тарифа?", tj:"Нархи обуна чанд?", uz:"Тариф нархи неча?" },
  { topic:"payments", ru:"WeChat оплата QR", tj:"WeChat пардохт QR", uz:"WeChat тўлов QR" }
];
for (const [i, item] of cases.entries()) {
  for (const lang of ["ru","tj","uz"]) {
    test("QA route " + (i + 1) + "/10 [" + lang + "] -> " + item.topic, () => {
      assert.ok(selectTopics(item[lang]).includes(item.topic), JSON.stringify(selectTopics(item[lang])));
      assert.ok(selectTopics(item[lang]).length <= 2);
    });
  }
}
