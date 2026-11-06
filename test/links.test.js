import test from "node:test";
import assert from "node:assert/strict";
import {chooseOfficialLink, appendOfficialLink, contextualKnowledgeQuery, platformLoginFollowup,
  isApprovedLinkResponse, recentAccountTopic, OFFICIAL_LINKS, directLinkOrGuideReply} from "../src/links.js";

const accountHistory=[
  {role:"user",content:"Аккаунт ва кириш / Account login"},
  {role:"assistant",content:"🔐 Аккаунт и вход. Уточните, где проблема: Android, PWA, Mini App."}
];

test("Android installation answers get official Railway-site download URL",()=>{
  assert.equal(chooseOfficialLink("Где скачать Android приложение?","Скачайте приложение","ru"),OFFICIAL_LINKS.download);
  assert.equal(appendOfficialLink("Установите HSK AI.",{input:"Как скачать Android приложение?",lang:"ru"}),
    "Установите HSK AI.\nhttps://hskai.app/download");
  assert.equal(appendOfficialLink("Откройте https://hskai.app/download",{input:"Где скачать Android приложение?",lang:"ru"}),
    "Откройте https://hskai.app/download");
});

test("account FAQ followed by Android keeps login context; does not turn into installation guide",()=>{
  assert.equal(recentAccountTopic(accountHistory),true);
  assert.deepEqual(contextualKnowledgeQuery("андроид",accountHistory),"аккаунт вход андроид");
  assert.equal(chooseOfficialLink("андроид","Скачайте приложение","ru",accountHistory),
    "https://hskai.app/ru/guide/faq/");
  const answer=platformLoginFollowup("андроид","ru",accountHistory);
  assert.match(answer,/Проблема со входом/);
  assert.match(answer,/https:\/\/hskai\.app\/ru\/guide\/faq\//);
  assert.doesNotMatch(answer,/скача|загруз/ui);
  assert.match(platformLoginFollowup("Android","uz",accountHistory),/uz\/guide\/faq/);
  assert.match(platformLoginFollowup("Android","tj",accountHistory),/tj\/guide\/faq/);
  assert.equal(platformLoginFollowup("Android","ru",[]),null);
  assert.equal(contextualKnowledgeQuery("андроид",[]),"андроид");
});

test("social-media links are matched individually without returning other brands",()=>{
  assert.equal(chooseOfficialLink("Instagram HSK AI","Откройте профиль"),OFFICIAL_LINKS.instagram);
  assert.equal(chooseOfficialLink("TikTok HSK AI","Откройте профиль"),OFFICIAL_LINKS.tiktok);
  assert.equal(chooseOfficialLink("Ютуб HSK AI","Смотрите канал"),OFFICIAL_LINKS.youtube);
  assert.equal(chooseOfficialLink("Ссылка на Telegram бот","Нажмите"),OFFICIAL_LINKS.telegram);
  assert.equal(chooseOfficialLink("Курс HSK 3","Изучайте"),null);
});

test("never deliver AI-invented checkout, phishing or malformed links",()=>{
  assert.equal(isApprovedLinkResponse("Перейдите на https://hskai.app/download"),true);
  assert.equal(isApprovedLinkResponse("Перейдите на https://fake-hskai.app/pay"),false);
  assert.equal(isApprovedLinkResponse("https://hskai.app.evil.org/download"),false);
  assert.equal(appendOfficialLink("Платите на https://fake-hskai.app",{input:"Где оплатить?"}),null);
});


test("natural links for screenshot requests: guide, resend, iPhone, with no invented PWA deep link",()=>{
  const history=[
    {role:"user",content:"Айфон иловасини ўрнатишим керак"},
    {role:"assistant",content:"Сиз iPhone'да веб-илова орқали киришингиз мумкин."}
  ];
  assert.match(directLinkOrGuideReply("йўриқномасини юбора оласизми?","uz",history),/hskai\.app\/uz\/guide\/faq/);
  assert.match(directLinkOrGuideReply("айфон иловасининг силкасини ташлаб беринг","uz",history),/https:\/\/hskai\.app$/);
  assert.match(directLinkOrGuideReply("силкани бошдан ташлаб бер нг","uz",history),/https:\/\/hskai\.app$/);
  assert.equal(directLinkOrGuideReply("Скриншотни юбордим. Android'да аккаунтим очилмаяпти.","uz",[]),null);
  assert.equal(directLinkOrGuideReply("Android'да Google кириш ишламайди","uz",[]),null);
  assert.match(directLinkOrGuideReply("Можешь скинуть ссылку на Android?","ru",[]),/https:\/\/hskai\.app\/download/);
  assert.match(directLinkOrGuideReply("iPhone приложения ссылку","ru",[]),/https:\/\/hskai\.app$/);
  assert.match(directLinkOrGuideReply("силкани бошдан ташлаб бер","uz",[]),/Қайси ҳавола керак/);
});
