import test from "node:test";
import assert from "node:assert/strict";
import {detectReplyLanguage, languageGuide, isObviouslyWrongLanguage} from "../src/language.js";

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
