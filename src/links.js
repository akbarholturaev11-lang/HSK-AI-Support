// Verified destinations: Railway production custom domain + HSK AI public-site
// /download and localized /guide/faq/ routes, and official app profile links.
// These links are intentionally allowlisted: model-generated URLs are not trusted.
export const OFFICIAL_LINKS = Object.freeze({
  home:"https://hskai.app",
  download:"https://hskai.app/download",
  iphonePwa:"https://hskai.app/iphone-pwa",
  telegram:"https://t.me/darsi_chini_bot",
  instagram:"https://www.instagram.com/hskai.app",
  tiktok:"https://www.tiktok.com/@hskai.app",
  youtube:"https://youtube.com/@hskai_app"
});

const PLATFORM_ONLY = /^(?:android|андроид|андроида|андроидда|pwa|iphone|айфон|ios|mini[\s-]?app|мини[\s-]?апп|telegram|телеграм|desktop|десктоп)$/iu;
const ACCOUNT_TOPIC = /аккаунт|account|вход|войти|логин|авторизац|кириш|ворид|ҳисоб/iu;

export function isPlatformOnly(input) {
  return PLATFORM_ONLY.test(String(input || "").trim());
}

export function recentAccountTopic(history=[]) {
  // The last FAQ/AI interaction only: do not dig across older unrelated topics.
  return (history.slice(-3)).some(x =>
    typeof x?.content==="string" && ACCOUNT_TOPIC.test(x.content));
}

export function contextualKnowledgeQuery(input,history=[]) {
  const question=String(input || "").trim().slice(0,650);
  if (isPlatformOnly(question) && recentAccountTopic(history)) return "аккаунт вход " + question;
  return question;
}

export function platformLoginFollowup(input,lang="ru",history=[]) {
  if (!isPlatformOnly(input) || !recentAccountTopic(history)) return null;
  const platform=String(input||"").trim().slice(0,22);
  const l=lang==="tj"?"tj":lang==="uz"?"uz":"ru";
  const messages={
    ru:"Проблема со входом на "+platform+"? Уточните: не открывается вход или появляется ошибка Google/Telegram?",
    tj:"Дар "+platform+" мушкили воридшавӣ чист: саҳифаи воридшавӣ кушода намешавад ё хатои Google/Telegram ҳаст?",
    uz:platform+" орқали аккаунтга киришда нима бўляпти: кириш ойнаси очилмайдими ёки Google/Telegram хатосими?"
  };
  return messages[l]+"\nhttps://hskai.app/"+l+"/guide/faq/";
}

export function chooseOfficialLink(input,answer,lang="ru",history=[]) {
  const q=String(input||"").toLowerCase().normalize("NFKC").trim();
  const a=String(answer||"").toLowerCase().normalize("NFKC");
  const qaRoot=String(lang==="tj"?"tj":lang==="uz"?"uz":"ru");
  const faq="https://hskai.app/"+qaRoot+"/guide/faq/";
  if (isPlatformOnly(q) && recentAccountTopic(history)) return faq;
  if (/(?:iphone|айфон|\bios\b|pwa)/u.test(q) && /(?:ссылка|ссылку|ссылк|силк|ҳавол|хавол|link|url|юбор|жўнат|жунат|ташла|скач|юклаб|ўрнат|урнат|открой|откр|ишлат|оч)/u.test(q)) return OFFICIAL_LINKS.iphonePwa;
  if (/(?:instagram|инстаграм|инста\b)/u.test(q)) return OFFICIAL_LINKS.instagram;
  if (/(?:tiktok|тикток|тик ток)/u.test(q)) return OFFICIAL_LINKS.tiktok;
  if (/(?:youtube|ютуб|ютюб|ю туб)/u.test(q)) return OFFICIAL_LINKS.youtube;
  if (/(?:телеграм|telegram)/u.test(q) && /бот|bot|канал|ссылка|линк|ҳавола|силка/u.test(q)) return OFFICIAL_LINKS.telegram;
  if (/(?:скача|загруз|download|apk\b|установ|ўрнат|юклаб|скач)/u.test(q) &&
      /(?:android|андроид|app|приложен|илова|программа|hsk|хск)/u.test(q)) return OFFICIAL_LINKS.download;
  if (/(?:android|андроид)/u.test(q) &&
      /(?:скача|загруз|download|установ|ўрнат|юклаб)/u.test(a) && !recentAccountTopic(history)) return OFFICIAL_LINKS.download;
  if (/^(?:официальный сайт|сайт hsk ai|сайт hsk|расмий сайт|website hsk ai|hsk ai сайт)$/u.test(q)) return OFFICIAL_LINKS.home;
  return null;
}

export function isApprovedLinkResponse(answer) {
  const urls=String(answer||"").match(/https?:\/\/[^\s<>"']+/giu)||[];
  // Never let the AI give users a fabricated checkout, phishing, or download URL.
  const allowed=new Set([...Object.values(OFFICIAL_LINKS),...["ru","tj","uz"].map(l=>"https://hskai.app/"+l+"/guide/faq/")]);
  return urls.every(u=>allowed.has(u.replace(/[).,;!?]+$/u,"")));
}

export function appendOfficialLink(answer,{input,lang,history=[]}) {
  const value=String(answer||"").trim();
  if (!value || !isApprovedLinkResponse(value)) return null;
  const url=chooseOfficialLink(input,value,lang,history);
  if (!url || value.includes(url)) return value;
  return value+"\n"+url;
}


// Users often say "send the link again", "give instructions", or type
// informal Cyrillic Uzbek. These simple questions should not require an
// expensive AI call or trigger the generic operator boilerplate.
const LINK_WORDS=/(?:ссыл|силк|ҳавол|хавол|\blink\b|\burl\b|манзил|адрес|посилан|йўриқном|йурикном|инструкц|қўлланм|кулланм)/iu;
const REQUEST_WORDS=/(?:юбор|жўнат|жунат|ташла|бер|керак|оласиз|мумкин|скажи|пришли|скинь|дай|send|share|қайта|кайта|бошдан|ещё|again|қайер|қаер|where)/iu;
const PRODUCT_WORDS=/(?:iphone|айфон|\bios\b|pwa|android|андроид|instagram|инстаграм|tiktok|тикток|youtube|ютуб|ютюб|telegram|телеграм|бот|website|сайт|hsk|хск)/iu;

function linkRequest(input) {
  const text=String(input||"").toLowerCase().normalize("NFKC").trim();
  return LINK_WORDS.test(text) && (REQUEST_WORDS.test(text)||PRODUCT_WORDS.test(text));
}

function requestedKind(input) {
  const s=String(input||"").toLowerCase().normalize("NFKC");
  if (/(?:iphone|айфон|\bios\b|pwa)/iu.test(s)) return "iphonePwa";
  if (/(?:android|андроид|apk\b)/iu.test(s)) return "download";
  if (/(?:instagram|инстаграм)/iu.test(s)) return "instagram";
  if (/(?:tiktok|тикток)/iu.test(s)) return "tiktok";
  if (/(?:youtube|ютуб|ютюб)/iu.test(s)) return "youtube";
  if (/(?:telegram|телеграм|telegram bot|телеграм бот)/iu.test(s)) return "telegram";
  if (/(?:веб.?сайт|расмий сайт|официальный сайт)/iu.test(s)) return "home";
  return null;
}

function lastRequestedKind(history=[]) {
  // Only recent user questions, never inferred from a generic bot disclaimer.
  for(const turn of history.slice(-5).reverse()) {
    if(turn?.role!=="user") continue;
    const kind=requestedKind(turn.content);
    if(kind) return kind;
  }
  return null;
}

function linkReply(kind,lang) {
  const l=["uz","tj","ru"].includes(lang)?lang:"ru";
  const messages={
    iphonePwa:{
      uz:"iPhone учун HSK AI веб-иловаси (PWA). Safari'да очиб, бош экранга қўшишингиз мумкин:",
      tj:"Барномаи вебии HSK AI (PWA) барои iPhone. Дар Safari кушоед ва ба экрани асосӣ илова кунед:",
      ru:"HSK AI для iPhone — веб-приложение (PWA). Откройте в Safari и добавьте на экран «Домой»:"
    },
    download:{
      uz:"Android учун HSK AI’ни расмий саҳифадан юклаб олинг:",
      tj:"Барномаи Android-и HSK AI-ро аз саҳифаи расмӣ боргирӣ кунед:",
      ru:"Официальная страница загрузки HSK AI для Android:"
    },
    instagram:{uz:"HSK AI Instagram саҳифаси:",tj:"Саҳифаи Instagram-и HSK AI:",ru:"Instagram HSK AI:"},
    tiktok:{uz:"HSK AI TikTok саҳифаси:",tj:"Саҳифаи TikTok-и HSK AI:",ru:"TikTok HSK AI:"},
    youtube:{uz:"HSK AI YouTube канали:",tj:"Канали YouTube-и HSK AI:",ru:"YouTube HSK AI:"},
    telegram:{uz:"HSK AI’нинг ўқув Telegram боти:",tj:"Боти таълимии HSK AI дар Telegram:",ru:"Учебный Telegram-бот HSK AI:"},
    home:{uz:"HSK AI расмий сайти:",tj:"Сомонаи расмии HSK AI:",ru:"Официальный сайт HSK AI:"}
  };
  return messages[kind][l]+"\n"+OFFICIAL_LINKS[kind];
}

function vagueClarification(input,lang) {
  const l=["uz","tj","ru"].includes(lang)?lang:"ru";
  const guide=/(?:йўриқном|йурикном|инструкц|қўлланм|кулланм)/iu.test(input);
  const messages=guide?{
    uz:"Қайси йўриқнома керак — iPhone PWA, Android ёки аккаунтга кириш?",
    tj:"Кадом дастур лозим: iPhone PWA, Android ё воридшавӣ ба ҳисоб?",
    ru:"Какая инструкция нужна — для iPhone PWA, Android или входа в аккаунт?"
  }:{
    uz:"Қайси ҳаволани юборай — iPhone, Android, Telegram ёки ижтимоий тармоқ?",
    tj:"Кадом пайванд лозим — iPhone, Android, Telegram ё шабакаҳои иҷтимоӣ?",
    ru:"Какую ссылку прислать — на iPhone, Android, Telegram или соцсеть?"
  };
  return messages[l];
}

export function directLinkAnswer(input,lang="ru",history=[]) {
  const q=String(input||"").trim().slice(0,650);
  if(!q) return null;
  // A platform-only answer to a previous link-clarification is also clear.
  const previous=history.slice(-3).some(t=>t?.role==="assistant" &&
    /(?:Қайси ҳаволани|Кадом пайванд|Какую ссылку|Қайси йўриқнома|Кадом дастур|Какая инструкция)/iu.test(t.content||""));
  const onlyPlatform=isPlatformOnly(q);
  if(!linkRequest(q) && !(previous && onlyPlatform)) return null;
  let kind=requestedKind(q);
  // An explicit "send the link" after login shouldn't become a download link
  // just because the assistant previously mentioned Android as a platform.
  if(!kind) kind=lastRequestedKind(history);
  if(kind) return linkReply(kind,lang);
  return vagueClarification(q,lang);
}

export function contextualProductQuery(input,history=[]) {
  const q=String(input||"").trim().slice(0,650);
  if (!q) return q;
  // Only short, genuinely elliptical follow-ups. A new question with its own
  // product term is never overridden by old context.
  if (q.length>100 || PRODUCT_WORDS.test(q)) return q;
  const followup=/(?:қайта|кайта|yana|яна|бошдан|тушунтир|объясн|ещё|again|как|қандай|қайси|qanday|ишлам|очилм|бўлм|не получается)/iu.test(q);
  if(!followup) return q;
  const recent=history.slice(-5).reverse().find(t=>t?.role==="user"&&PRODUCT_WORDS.test(t.content||""));
  return recent ? String(recent.content).slice(0,180)+"\nСавол давоми: "+q : q;
}
