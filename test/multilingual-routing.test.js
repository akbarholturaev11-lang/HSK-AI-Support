import test from "node:test";
import assert from "node:assert/strict";
import { selectKnowledgeTopics } from "../src/knowledge.js";

// Thirty local-language customer questions exercise the 7-topic V2 R2 router.
// These are deterministic routing checks, not provider quality or production tests.
const scenarios=[
  ["payment declined","payments",[
    "Почему не прошла оплата?", "Чаро пардохт нашуд?", "Тўловим нега ўтмади?"
  ]],
  ["subscription expiry","subscriptions",[
    "Когда заканчивается подписка?", "Обуна кай тамом мешавад?", "Обунам қачон тугайди?"
  ]],
  ["account login","accounts",[
    "Как войти в аккаунт?", "Чӣ тавр ба аккаунт дароям?", "Аккаунтга қандай кираман?"
  ]],
  ["android app","android",[
    "Android приложение вылетает", "Android барнома кор намекунад", "Андроид илова ёпилиб қолди"
  ]],
  ["PWA iPhone","pwa",[
    "PWA на iPhone не работает", "PWA дар iPhone кор намекунад", "PWA айфонда очилмаяпти"
  ]],
  ["telegram app","telegram",[
    "Telegram mini app не открывается", "Телеграм ботам кор намекунад", "Телеграм боти очилмайди"
  ]],
  ["general information","general",[
    "Что такое HSK AI?", "HSK AI чист?", "HSK AI нима?"
  ]],
  ["course lessons","general",[
    "Где уроки HSK?", "Дарсҳои HSK куҷоянд?", "HSK дарслари қаерда?"
  ]],
  ["referrals","telegram",[
    "Реферал бонус не появился", "Реферал бонус чӣ тавр?", "Реферал бонусини қандай оламан?"
  ]],
  ["android errors","android",[
    "Ошибка на экране Android", "Хато дар Android", "Android хато чиқяпти"
  ]]
];
for(const [name,expected,questions] of scenarios){
  for(const [i,question] of questions.entries()){
    const lang=["ru","tj","uz"][i];
    test("V2 KB routing "+name+" "+lang,()=>{
      assert.ok(selectKnowledgeTopics(question).includes(expected),question);
    });
  }
}
