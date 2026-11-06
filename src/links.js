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
