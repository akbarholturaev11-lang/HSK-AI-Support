// Only code-verified public destinations. Never guess checkout or PWA deep links.
export const OFFICIAL_LINKS=Object.freeze({
  home:"https://hskai.app",
  download:"https://hskai.app/download",
  telegram:"https://t.me/darsi_chini_bot",
  instagram:"https://www.instagram.com/hskai.app",
  tiktok:"https://www.tiktok.com/@hskai.app",
  youtube:"https://youtube.com/@hskai_app"
});

function faqUrl(lang) {
  const l=["tj","uz"].includes(lang)?lang:"ru";
  return "https://hskai.app/"+l+"/guide/faq/";
}

export function chooseOfficialLink(input,answer,lang="ru",history=[]) {
  const q=String(input||"").toLowerCase().normalize("NFKC");
  const askingPwa=/(?:iphone|айфон|ios|\bpwa\b)/u.test(q);
  const previous=history.filter(x=>x.role==="user").slice(-2)
    .map(x=>String(x.content||"")).join(" ").toLowerCase();
  if (/instagram|инстаграм|инста\b/u.test(q)) return OFFICIAL_LINKS.instagram;
  if (/tiktok|тикток|тик ток/u.test(q)) return OFFICIAL_LINKS.tiktok;
  if (/youtube|ютуб|ютюб/u.test(q)) return OFFICIAL_LINKS.youtube;
  if (/(?:telegram|телеграм)/u.test(q) && /(?:бот|bot|ссылка|ҳавола|силка|канал)/u.test(q))
    return OFFICIAL_LINKS.telegram;
  if (/(?:йўриқнома|йурикнома|қўлланма|инструкц|руководств|guide|faq)/u.test(q) ||
      /(?:guide|faq)/u.test(previous) && /(?:силка|ссылк|ҳавола|линк)/u.test(q))
    return faqUrl(lang);
  if ((/(?:android|андроид|apk\b)/u.test(q) && /(?:скача|download|юклаб|установ|ўрнат|силка|ссылк|ҳавола)/u.test(q)) ||
      !askingPwa && /(?:силка|ссылк|ҳавола|линк)/u.test(q) && /(?:android|андроид)/u.test(previous) &&
      /(?:скача|download|юклаб|установ|ўрнат)/u.test(previous))
    return OFFICIAL_LINKS.download;
  if (/^(?:официальный сайт|сайт hsk ai|расмий сайт|website hsk ai)$/u.test(q))
    return OFFICIAL_LINKS.home;
  // iPhone/PWA must have a verified direct URL; the home page is NOT the PWA link.
  return null;
}

export function isApprovedLinkResponse(answer) {
  const urls=String(answer||"").match(/https?:\/\/[^\s<>"']+/giu)||[];
  const allow=new Set([...Object.values(OFFICIAL_LINKS),...["ru","tj","uz"].map(faqUrl)]);
  return urls.every(u=>allow.has(u.replace(/[).,;!?]+$/u,"")));
}

export function appendOfficialLink(answer,{input,lang,history=[]}) {
  const text=String(answer||"").trim();
  if(!text||!isApprovedLinkResponse(text))return null;
  const url=chooseOfficialLink(input,text,lang,history);
  return url&&!text.includes(url)?text+"\n"+url:text;
}
