import test from "node:test";
import assert from "node:assert/strict";
import {detectReplyLanguage, languageGuide, isObviouslyWrongLanguage, isConversationalTurn, conversationalFallback} from "../src/language.js";

test("explicit user language overrides earlier deep-link/Telegram language",()=>{
  assert.equal(detectReplyLanguage("ru","HSK AI чист?"),"tj");
  assert.equal(detectReplyLanguage("uz","Чаро барнома кор намекунад?"),"tj");
  assert.equal(detectReplyLanguage("tj","HSK AI нима?"),"uz");
  assert.equal(detectReplyLanguage("ru","Тўловим нега ўтмади?"),"uz");
  assert.equal(detectReplyLanguage("tj","Почему не открывается приложение?"),"ru");
  assert.equal(detectReplyLanguage("uz","HSK AI?"),"uz");
  assert.equal(detectReplyLanguage("tj","HSK AI?"),"tj");
});

test("Tajik language instructions don't silently become Uzbek",()=>{
  assert.ok(languageGuide("tj").join(" ").includes("барои"));
  assert.ok(languageGuide("uz").join(" ").includes("учун"));
  assert.ok(languageGuide("ru").join(" ").includes("Cyrillic script"));
  assert.equal(isObviouslyWrongLanguage("tj","HSK AI — бу хитой тилини ўрганиш иловаси."),true);
  assert.equal(isObviouslyWrongLanguage("tj","HSK AI барномаест барои омӯзиши забони чинӣ."),false);
  assert.equal(isObviouslyWrongLanguage("uz","Шумо метавонед барномаро истифода баред."),true);
  assert.equal(isObviouslyWrongLanguage("uz","Илованинг ушбу бўлимини текшириб кўринг."),false);
  assert.equal(isObviouslyWrongLanguage("ru","Проверьте раздел приложения."),false);
  assert.equal(isObviouslyWrongLanguage("ru","HSK AI — хитой тилини ўрганиш иловаси."),true);
});


test("automatic language inference handles explicit requests and short ambiguous follow-ups",()=>{
  assert.equal(detectReplyLanguage("ru","салом ўзбек тилида суҳбатлаша оламизми?"),"uz");
  assert.equal(detectReplyLanguage("ru","salom uzbek tilida gaplasha olamizmi?"),"uz");
  assert.equal(detectReplyLanguage("ru","Salom, menga yordam kerak"),"uz");
  assert.equal(detectReplyLanguage("ru","Shumo baroi HSK AI metavoned yordam dihed?"),"tj");
  assert.equal(detectReplyLanguage("ru","Салом, ўзбек тилида суҳбатлашсак бўладими?"),"uz");
  assert.equal(detectReplyLanguage("ru","Салом"),"ru","ambiguous greeting retains saved language");
  assert.equal(detectReplyLanguage("uz","Салом"),"uz","Uzbek conversation remains Uzbek");
  assert.equal(detectReplyLanguage("uz","ээээ"),"uz","filler retains saved language");
  assert.equal(detectReplyLanguage("uz","Привет!"),"ru");
  assert.equal(detectReplyLanguage("ru","Можете ответить на тоҷикӣ?"),"tj");
  assert.equal(detectReplyLanguage("uz","HSK AI нима?"),"uz");
  assert.equal(detectReplyLanguage("ru","HSK AI чист?"),"tj");
  assert.equal(isObviouslyWrongLanguage("uz","Уточните, пожалуйста, ваш вопрос."),true);
  assert.equal(isObviouslyWrongLanguage("tj","Уточните, пожалуйста, ваш вопрос."),true);
});

test("casual turns bypass product KB only when no substantive question is present",()=>{
  assert.equal(isConversationalTurn("салом ўзбек тилида суҳбатлаша оламизми?"),true);
  assert.equal(isConversationalTurn("салом"),true);
  assert.equal(isConversationalTurn("ээээ"),true);
  assert.equal(isConversationalTurn("Ўзбек тилида тўловимни текширинг"),false);
  assert.equal(isConversationalTurn("Тарифни ўзбек тилида тушунтир"),false);
  assert.equal(isConversationalTurn("Рус тилида обуна нархи қанча?"),false);
  assert.equal(isConversationalTurn("HSK AI ҳақида ўзбекча тушунтир"),false);
  assert.equal(isConversationalTurn("Мой аккаунт не работает"),false);
  assert.match(conversationalFallback("ээээ","uz"),/HSK AI/);
  assert.match(conversationalFallback("ўзбек тилида суҳбатлашайлик","uz"),/Ўзбек тилида/);
  assert.equal(conversationalFallback("Пардохт не работает","tj"),null);
});
