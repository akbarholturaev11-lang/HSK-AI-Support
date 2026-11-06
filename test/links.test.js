import test from "node:test";
import assert from "node:assert/strict";
import {chooseOfficialLink,appendOfficialLink,isApprovedLinkResponse,OFFICIAL_LINKS} from "../src/links.js";

test("verified Android, FAQ and social links are available without a canned reply",()=>{
  assert.equal(chooseOfficialLink("Android APK скачат","", "ru"),OFFICIAL_LINKS.download);
  assert.equal(chooseOfficialLink("Йўриқномани юборинг","", "uz"),"https://hskai.app/uz/guide/faq/");
  assert.equal(chooseOfficialLink("Instagram HSK AI",""),OFFICIAL_LINKS.instagram);
  assert.equal(chooseOfficialLink("TikTok HSK AI",""),OFFICIAL_LINKS.tiktok);
  assert.equal(chooseOfficialLink("YouTube HSK AI",""),OFFICIAL_LINKS.youtube);
  assert.equal(chooseOfficialLink("Ссылка на Telegram бот",""),OFFICIAL_LINKS.telegram);
  assert.equal(appendOfficialLink("Расмий саҳифа:",{input:"Android скачать",lang:"uz"}),
    "Расмий саҳифа:\nhttps://hskai.app/download");
});

test("contextual link resend works for verified files; PWA home page is not presented as app",()=>{
  const history=[{role:"user",content:"Где скачать Android приложение?"}];
  assert.equal(chooseOfficialLink("ссылку","", "ru",history),OFFICIAL_LINKS.download);
  assert.equal(chooseOfficialLink("PWA силкаси керак","", "uz",history),null);
  assert.equal(chooseOfficialLink("айфон иловасининг силкасини ташлаб беринг","", "uz"),null);
  assert.equal(appendOfficialLink("PWA ҳаволаси тасдиқланмаган.",{input:"PWA ссылка",lang:"uz"}),
    "PWA ҳаволаси тасдиқланмаган.");
});

test("reject invented checkout, impersonation and unsupported URLs",()=>{
  assert.equal(isApprovedLinkResponse("https://hskai.app/download"),true);
  assert.equal(isApprovedLinkResponse("https://fake-hskai.app/pay"),false);
  assert.equal(isApprovedLinkResponse("https://hskai.app.evil.org/download"),false);
  assert.equal(appendOfficialLink("https://fake-hskai.app",{input:"Оплата"}),null);
});
