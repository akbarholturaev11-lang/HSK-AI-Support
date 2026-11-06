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
  assert.equal(chooseOfficialLink("PWA силкаси керак","", "uz",history),OFFICIAL_LINKS.iphonePwa);
  assert.equal(chooseOfficialLink("айфон иловасининг силкасини ташлаб беринг","", "uz"),OFFICIAL_LINKS.iphonePwa);
  assert.equal(appendOfficialLink("PWA ҳаволаси тасдиқланмаган.",{input:"PWA ссылка",lang:"uz"}),
    "PWA ҳаволаси тасдиқланмаган.\\nhttps://hskai.app/iphone-pwa");
});

test("reject invented checkout, impersonation and unsupported URLs",()=>{
  assert.equal(isApprovedLinkResponse("https://hskai.app/download"),true);
  assert.equal(isApprovedLinkResponse("https://fake-hskai.app/pay"),false);
  assert.equal(isApprovedLinkResponse("https://hskai.app.evil.org/download"),false);
  assert.equal(appendOfficialLink("https://fake-hskai.app",{input:"Оплата"}),null);
});

test("iPhone PWA follow-up sends full link; Android and site remain distinct",()=>{
  const history=[{role:"user",content:"Салом менга айфон учун иловани каердан урнатишни аетиб юборинг"}];
  assert.equal(chooseOfficialLink("силкасини бера оласизми ?","", "uz",history),OFFICIAL_LINKS.iphonePwa);
  assert.equal(chooseOfficialLink("iOS учун қаердан ўрнатсам бўлади","", "uz"),OFFICIAL_LINKS.iphonePwa);
  assert.equal(chooseOfficialLink("Android APK ссылка","", "ru"),OFFICIAL_LINKS.download);
  assert.equal(OFFICIAL_LINKS.home,"https://hskai.app");
  assert.equal(isApprovedLinkResponse("https://hskai.app/iphone-pwa"),true);
  assert.equal(isApprovedLinkResponse("https://hskai.app/iphone-pwa-malware"),false);
});

test("learning Telegram bot and news channel never get conflated",()=>{
  assert.equal(chooseOfficialLink("Ссылка на Telegram бот","", "ru"),OFFICIAL_LINKS.telegram);
  assert.equal(chooseOfficialLink("Telegram янгиликлар канали ҳаволаси","", "uz"),OFFICIAL_LINKS.telegramNews);
  assert.equal(chooseOfficialLink("Ссылка на канал","", "ru",[{role:"user",content:"Telegram новости"}]),OFFICIAL_LINKS.telegramNews);
  assert.equal(chooseOfficialLink("Бот силкасини бер","", "uz",[{role:"user",content:"Telegram бот"}]),OFFICIAL_LINKS.telegram);
});

test("Russian and Tajik social handles are separate; URLs remain exact-allowlisted",()=>{
  assert.equal(chooseOfficialLink("Instagram","", "tj"),OFFICIAL_LINKS.instagramTj);
  assert.equal(chooseOfficialLink("YouTube тоҷикча","", "uz"),OFFICIAL_LINKS.youtubeTj);
  assert.equal(chooseOfficialLink("TikTok Tajik","", "ru"),OFFICIAL_LINKS.tiktokTj);
  assert.equal(chooseOfficialLink("TikTok русский","", "tj"),OFFICIAL_LINKS.tiktok);
  assert.equal(isApprovedLinkResponse(OFFICIAL_LINKS.instagramTj),true);
  assert.equal(isApprovedLinkResponse(OFFICIAL_LINKS.telegramNews),true);
  assert.equal(isApprovedLinkResponse("https://hskai.app/fake-checkout"),false);
});
