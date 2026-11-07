// Verified public product destinations: HSK-AI-Bot/main and Kantent/main.
// Do not infer a checkout link, an App Store listing, a Mini App startapp URL or a Facebook page URL.
export const OFFICIAL_LINKS=Object.freeze({
  home:"https://hskai.app",
  download:"https://hskai.app/download",
  iphonePwa:"https://hskai.app/iphone-pwa",
  privacy:"https://hskai.app/privacy",
  terms:"https://hskai.app/terms",
  accountDeletion:"https://hskai.app/account-deletion",
  telegram:"https://t.me/darsi_chini_bot",
  telegramNews:"https://t.me/hskaiapp",
  support:"https://t.me/hskai_support_bot",
  instagram:"https://www.instagram.com/hskai.app",
  instagramTj:"https://www.instagram.com/hskai.apptj/",
  tiktok:"https://www.tiktok.com/@hskai.app",
  tiktokTj:"https://www.tiktok.com/@hskai.ru",
  youtube:"https://youtube.com/@hskai_app",
  youtubeTj:"https://www.youtube.com/@hskaiapp-tj"
});

function faqUrl(lang) {
  const l=["tj","uz"].includes(lang)?lang:"ru";
  return "https://hskai.app/"+l+"/guide/faq/";
}

// Public marketing routes from HSK-AI-Bot/app/public_site/content.py PAGE_TRANSLATIONS.
// These are information pages, not app installers, payment pages or Mini App deep links.
export const SITE_PAGES=Object.freeze({
  localizedHome:{ru:"https://hskai.app/ru/",tj:"https://hskai.app/tj/",uz:"https://hskai.app/uz/"},
  hsk:{ru:"https://hskai.app/ru/hsk/",tj:"https://hskai.app/tj/hsk/",uz:"https://hskai.app/uz/hsk/"},
  learnChinese:{ru:"https://hskai.app/ru/learn-chinese/",tj:"https://hskai.app/tj/learn-chinese/",uz:"https://hskai.app/uz/learn-chinese/"},
  aiTeacher:{ru:"https://hskai.app/ru/ai-chinese-teacher/",tj:"https://hskai.app/tj/ai-chinese-teacher/",uz:"https://hskai.app/uz/ai-chinese-teacher/"},
  guide:{ru:"https://hskai.app/ru/guide/",tj:"https://hskai.app/tj/guide/",uz:"https://hskai.app/uz/guide/"},
  guideFeatures:{ru:"https://hskai.app/ru/guide/features/",tj:"https://hskai.app/tj/guide/features/",uz:"https://hskai.app/uz/guide/features/"},
  guideSubscription:{ru:"https://hskai.app/ru/guide/subscription/",tj:"https://hskai.app/tj/guide/subscription/",uz:"https://hskai.app/uz/guide/subscription/"}
});

export const GOOGLE_SIGNIN_PRIVACY=Object.freeze({
  uz:"https://hskai.app/privacy/google-sign-in/",
  ru:"https://hskai.app/privacy/google-sign-in/ru/",
  tj:"https://hskai.app/privacy/google-sign-in/tj/"
});

function sitePage(kind,lang) {
  return SITE_PAGES[kind][["ru","tj","uz"].includes(lang)?lang:"ru"];
}

const linkRequest=/(?:силка|ссылк|ҳавола|хавола|линк|link|url|манзил|адрес|юбор|отправ|ташлаб|бериб|скин)/u;
const iphone=/(?:iphone|айфон|\bios\b|\bpwa\b)/u;
const install=/(?:скача|download|юклаб|установ|ўрнат|урнат|орнат|o.rnat|install|очиш|откр|қаер|каер|qayer|where|куда)/u;

function preferTajik(query,lang) {
  if (/(?:русск|russian|рус тили|ru account|русча)/u.test(query)) return false;
  if (/(?:таджик|тожик|тоҷик|tajik|\btj\b|\btg\b|@hskai\.apptj|@hskaiapp-tj|@hskai\.ru)/u.test(query)) return true;
  return lang==="tj";
}

export function chooseOfficialLink(input,answer,lang="ru",history=[]) {
  const q=String(input||"").toLowerCase().normalize("NFKC");
  const previous=history.filter(x=>x.role==="user").slice(-3)
    .map(x=>String(x.content||"")).join(" ").toLowerCase().normalize("NFKC");
  const wantsLink=linkRequest.test(q);
  const isIphone=iphone.test(q);
  const wasIphone=iphone.test(previous);
  const isTg=/(?:telegram|телеграм|t\.me|@darsi_chini_bot|@hskaiapp)/u.test(q);
  const wasTg=/(?:telegram|телеграм|@hskaiapp|@darsi_chini_bot)/u.test(previous);
  const isNews=/(?:канал|channel|новост|янгил|хабар|ахбор|@hskaiapp)/u.test(q);

  // Support and education bots are different official accounts.
  if (/(?:поддержк|support|ёрдам|ѐрдам|ёрӣ|оператор|қўллаб.қувват|қуллаб.қувват)/u.test(q) &&
      (wantsLink || /(?:бот|bot|telegram|телеграм|контакт|ссылка|силк|ҳавола|хавола)/u.test(q)))
    return OFFICIAL_LINKS.support;
  if (/instagram|инстаграм|инста\b/u.test(q))
    return preferTajik(q,lang)?OFFICIAL_LINKS.instagramTj:OFFICIAL_LINKS.instagram;
  if (/tiktok|тикток|тик ток/u.test(q))
    return preferTajik(q,lang)?OFFICIAL_LINKS.tiktokTj:OFFICIAL_LINKS.tiktok;
  if (/youtube|ютуб|ютюб/u.test(q))
    return preferTajik(q,lang)?OFFICIAL_LINKS.youtubeTj:OFFICIAL_LINKS.youtube;

  if ((isTg&&isNews) || (isNews && /(?:telegram|телеграм|канал|channel|news)/u.test(previous)))
    return OFFICIAL_LINKS.telegramNews;
  if ((isTg && /(?:бот|bot|силка|ссылк|ҳавола|хавола|линк|канал)/u.test(q)) ||
      (wantsLink && wasTg && /(?:бот|bot|ўқиш|дарс|учеб|learn)/u.test(previous)))
    return OFFICIAL_LINKS.telegram;

  // Narrow public marketing requests before the generic FAQ rule.
  const pageRequest=wantsLink || /(?:страниц|саҳифа|сахифа|сайт|website|где почитать|куда зайти|\bpage\b)/u.test(q);
  const pageContext=pageRequest && wantsLink ? (q+" "+previous) : q;
  if (pageRequest) {
    if (/(?:google|гугл)/u.test(pageContext) &&
        /(?:privacy|конфиденц|махфий|сиррият|шахсий маълумот)/u.test(pageContext))
      return GOOGLE_SIGNIN_PRIVACY[["ru","tj","uz"].includes(lang)?lang:"ru"];
    if (/(?:подпис|обуна|обун|тариф|subscription|пардохт|тўлов|тулов)/u.test(pageContext) &&
        /(?:guide|руководств|инструкц|қўлланма|йўриқ|страниц|саҳифа|сахифа)/u.test(pageContext))
      return sitePage("guideSubscription",lang);
    if (/(?:функц|имконият|хусусият|features)/u.test(pageContext) &&
        /(?:guide|руководств|инструкц|қўлланма|йўриқ)/u.test(pageContext))
      return sitePage("guideFeatures",lang);
    if (/(?:ai teacher|ai ўқитувч|ai укитувч|аи ўқитувч|ai преподавател|ai муаллим|ai-чinese|ai-chinese)/u.test(pageContext))
      return sitePage("aiTeacher",lang);
    if (/(?:хитой тилини ўрган|хитой тилини урган|китайск.*с нуля|learn chinese|beginner chinese)/u.test(pageContext))
      return sitePage("learnChinese",lang);
    if (/(?:\bhsk\b|\bхск\b)/u.test(pageContext) && /(?:курс|course|сайт|website|страниц|саҳифа|сахифа)/u.test(pageContext))
      return sitePage("hsk",lang);
    if (/(?:қўлланма асосий|йўриқнома асосий|главн.*руководств|guide home|guide index)/u.test(pageContext))
      return sitePage("guide",lang);
    if (/(?:главн.*сайт|бош саҳифа|асосий саҳифа|сайтнинг бош|site home)/u.test(pageContext))
      return sitePage("localizedHome",lang);
  }

  if (/(?:йўриқнома|йурикнома|қўлланма|инструкц|руководств|guide|faq)/u.test(q) ||
      wantsLink && /(?:guide|faq|йўриқнома|инструкц)/u.test(previous))
    return faqUrl(lang);

  if (/(?:privacy|конфиденц|махфийлик|махфият|сиррияти)/u.test(q)) return OFFICIAL_LINKS.privacy;
  if (/(?:terms of use|условия использования|фойдаланиш шарт|шартҳои истифода)/u.test(q)) return OFFICIAL_LINKS.terms;
  if (/(?:account deletion|удалени.*аккаунт|аккаунт.*удалени|ҳисоб.*нест|аккаунт.*ўчир)/u.test(q))
    return OFFICIAL_LINKS.accountDeletion;

  // iPhone PWA is NOT the Android /download page; follow-up 'send the link'
  // must consult the previous user turn rather than fall back to the homepage.
  if ((isIphone && (install.test(q)||wantsLink)) ||
      (wantsLink && wasIphone)) return OFFICIAL_LINKS.iphonePwa;

  if ((/(?:android|андроид|apk\b|macos|macbook|windows|виндовс|компьютер|desktop)/u.test(q) &&
       (install.test(q)||wantsLink)) ||
      (wantsLink && !isIphone && /(?:android|андроид|apk\b|macos|windows|desktop)/u.test(previous)))
    return OFFICIAL_LINKS.download;

  if (/^(?:официальный сайт|сайт hsk ai|расмий сайт|website hsk ai|hsk ai сайти)$/u.test(q) ||
      (wantsLink && /(?:сайт|website)/u.test(q))) return OFFICIAL_LINKS.home;
  return null;
}

export function isApprovedLinkResponse(answer) {
  const urls=String(answer||"").match(/https?:\/\/[^\s<>"']+/giu)||[];
  const allow=new Set([...Object.values(OFFICIAL_LINKS),...["ru","tj","uz"].map(faqUrl),...Object.values(SITE_PAGES).flatMap(Object.values),...Object.values(GOOGLE_SIGNIN_PRIVACY)]);
  // Allow an ordinary optional trailing slash; no arbitrary paths or query parameters.
  for(const u of [...allow])allow.add(u.endsWith("/")?u.slice(0,-1):u+"/");
  return urls.every(u=>allow.has(u.replace(/[).,;!?]+$/u,"")));
}

export function appendOfficialLink(answer,{input,lang,history=[]}) {
  const text=String(answer||"").trim();
  if(!text||!isApprovedLinkResponse(text))return null;
  const url=chooseOfficialLink(input,text,lang,history);
  return url&&!text.includes(url)?text+"\n"+url:text;
}
