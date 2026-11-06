// Verified destinations: Railway production custom domain + HSK AI public-site
// /download and localized /guide/faq/ routes, and official app profile links.
// These links are intentionally allowlisted: model-generated URLs are not trusted.
export const OFFICIAL_LINKS = Object.freeze({
  home:"https://hskai.app",
  download:"https://hskai.app/download",
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
  if (/(?:instagram|инстаграм|инста\b)/u.test(q)) return OFFICIAL_LINKS.instagram;
  if (/(?:tiktok|тикток|тик ток)/u.test(q)) return OFFICIAL_LINKS.tiktok;
  if (/(?:youtube|ютуб|ютюб|ю туб)/u.test(q)) return OFFICIAL_LINKS.youtube;
  if (/(?:телеграм|telegram)/u.test(q) && /бот|bot|канал|ссылка|линк|ҳавола|силка/u.test(q)) return OFFICIAL_LINKS.telegram;
  if (/(?:скача|загруз|download|apk\b|установ|ўрнат|юклаб|скач)/u.test(q) &&
      /(?:android|андроид|app|приложен|илова|программа|hsk|хск)/u.test(q)) return OFFICIAL_LINKS.download;
  if (/(?:android|андроид)/u.test(q) &&
      /(?:скача|загруз|download|установ|ўрнат|юклаб)/u.test(a) && !recentAccountTopic(history)) return OFFICIAL_LINKS.download;
  if (/(?:iphone|айфон|ios|pwa)/u.test(q) && /(?:силка|ссылк|ҳавола|линк|манзил|юбор|ташлаб|беринг|скача|ўрнат|установ|download)/u.test(q)) return OFFICIAL_LINKS.home;
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


// Give immediate, factual answers to common link/how-to requests. No model
// call, no guessed PWA deep link, and no repeating an unrelated support script.
const LINK_REQUEST = /(?:ссылк|силк|линк|ҳавола|хавола|link\b|url\b|адрес|манзил|юбор|ташлаб|скинь|отправ|жўнат|жунат)/iu;
const IPHONE = /(?:iphone|айфон|\bios\b|\bpwa\b|айфонда)/iu;
const ANDROID = /(?:android|андроид|apk\b)/iu;
const GUIDE = /(?:йўриқнома|йурикнома|қўлланма|кулланма|инструкц|руководств|guide|how.to|кўрсатма|курсатма)/iu;
const RESEND = /(?:бошдан|қайта|қайтадан|яна|повтор|ещё\s*раз|снова|again)/iu;

const replies = {
  ru: {
    iphone:"На iPhone HSK AI доступен через веб-приложение. Откройте официальный сайт в Safari и при наличии нужной страницы добавьте её на экран «Домой».",
    android:"Android-версию HSK AI можно скачать на официальной странице.",
    guide:"Вот руководство и ответы на частые вопросы HSK AI:",
    which:"Какую ссылку прислать: Android, iPhone или инструкцию?"
  },
  uz: {
    iphone:"iPhone'да HSK AI веб-илова орқали ишлайди. Расмий сайтни Safari'да очинг; PWA саҳифаси бўлса, уни «Бош экранга қўшиш» мумкин.",
    android:"Android учун HSK AI'ни расмий саҳифадан юклаб олинг:",
    guide:"HSK AI йўриқномаси ва кўп сўраладиган саволлар:",
    which:"Қайси ҳавола керак: Android, iPhone ёки йўриқнома?"
  },
  tj: {
    iphone:"Дар iPhone HSK AI ҳамчун веб-барнома дастрас аст. Сомонаи расмиро бо Safari кушоед ва агар саҳифаи PWA дастрас бошад, ба экрани асосӣ илова кунед.",
    android:"Барномаи Android-и HSK AI аз саҳифаи расмӣ дастрас аст:",
    guide:"Роҳнамо ва саволҳои маъмули HSK AI:",
    which:"Кадом пайванд лозим: Android, iPhone ё роҳнамо?"
  }
};
function recentWords(history=[]) {
  return history.slice(-5).map(x=>x?.content||"").join(" ").toLowerCase();
}

export function directLinkOrGuideReply(input,lang="ru",history=[]) {
  const q=String(input||"").toLowerCase().normalize("NFKC").trim();
  if (!q || q.length>450) return null;
  const l=lang==="tj"?"tj":lang==="uz"?"uz":"ru";
  const r=replies[l];
  const context=recentWords(history);
  // Only explicit guide or link requests are handled here; a bare platform
  // after an account FAQ is still handled by platformLoginFollowup.
  if (GUIDE.test(q) && (LINK_REQUEST.test(q) || /(?:дай|бер|қайда|қаер|где|можно|хоҳ|керак|please)/iu.test(q))) {
    return r.guide+"\nhttps://hskai.app/"+l+"/guide/faq/";
  }
  if (IPHONE.test(q) && (LINK_REQUEST.test(q) || /(?:скача|юклаб|скачать|установ|ўрнат|загруз)/iu.test(q))) {
    // The verified public website is safe to share; do not fabricate a
    // /iphone-pwa URL without confirmation that the runtime route exists.
    return r.iphone+"\n"+OFFICIAL_LINKS.home;
  }
  if (ANDROID.test(q) && (LINK_REQUEST.test(q) || /(?:скача|юклаб|скачать|установ|ўрнат|загруз)/iu.test(q))) {
    return r.android+"\n"+OFFICIAL_LINKS.download;
  }
  if (LINK_REQUEST.test(q) && (RESEND.test(q) || /(?:бер|юбор|отправ|скинь|ташла|керак)/iu.test(q))) {
    if (IPHONE.test(context) && !ANDROID.test(context)) return r.iphone+"\n"+OFFICIAL_LINKS.home;
    if (ANDROID.test(context) && !IPHONE.test(context)) return r.android+"\n"+OFFICIAL_LINKS.download;
    if (GUIDE.test(context) || /guide\/faq|аккаунт|account|кириш/u.test(context)) {
      return r.guide+"\nhttps://hskai.app/"+l+"/guide/faq/";
    }
    return r.which;
  }
  return null;
}
