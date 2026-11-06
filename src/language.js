// Deterministic hints for RU/TJ/UZ. Deep-link locale remains the fallback;
// explicit language in a user's latest message overrides the saved locale.
// Recognize RU/TJ/UZ automatically. A mixed or short greeting must not
// override the persisted language; an explicit language request always wins.
const LEXICON = {
  uz: ["ўзбек", "узбек", "ўзбекча", "узбекча", "нима", "қандай", "қаерда", "қайси", "менга",
    "менда", "керак", "бўлади", "бўладими", "оламизми", "суҳбатлаша", "гаплаша", "гаплаш",
    "илова", "ишламаяпти", "очилмаяпти", "тўлов", "тулов", "ўрганиш", "йўқ", "рахмат",
    "ёзинг", "берасизми", "қиламан", "хоҳлайман", "дегани",
    "yaxshimisan", "gaplash", "gaplashamizmi", "gaplasha", "suhbat", "tilida", "tilda",
    "menga", "menda", "nima", "qanday", "qayerda", "qaysi", "kerak", "nega", "yordam",
    "ishlamayapti", "boʻladi", "boladi", "qilaman", "oʻzbek", "uzbekcha", "rahmat"],
  tj: ["тоҷик", "тоҷикӣ", "таджик", "чаро", "чӣ", "чист", "шумо", "барои", "метавонам",
    "метавонед", "куҷо", "забони", "ҳаст", "лутфан", "мехоҳам", "нависед", "пардохт",
    "ташаккур", "намекунад", "маро", "дар", "наметавонам", "shumo", "baroi",
    "zaboni", "metavonam", "charo", "tojik", "chi"],
  ru: ["привет", "здравствуйте", "спасибо", "пожалуйста", "почему", "как", "что", "где",
    "когда", "можно", "можем", "нужно", "помогите", "приложение", "подписка", "ошибка",
    "оплата", "войти", "напишите", "уточните", "говорить", "общаться", "русский",
    "какой", "ваш", "вопрос", "ответьте", "работает"]
};

export function explicitlyRequestedLanguage(message) {
  const s=String(message||"").toLowerCase().normalize("NFKC").slice(0,700);
  const request=/(?:тил(?:и|ида|да|ини|га)?|забон|язык|языке|суҳбат|сухбат|гаплаш|сўзлаш|suhbat|gaplash|tilida|tilda|language|speak|talk|говор|обща|ответ|жавоб|reply|ёзинг|напиши|по-русски)/u.test(s);
  if(!request) return null;
  const candidates=[
    ["uz",/(?:ўзбек|узбек|o['’ʻ‘]?zbek|uzbek|uzb(?:ek)?cha)/u],
    ["tj",/(?:тоҷик|таджик|tojik|tajik)/u],
    ["ru",/(?:русск|русча|ruscha|russian|po-russki)/u]
  ].filter(([,pattern])=>pattern.test(s));
  return candidates.length===1 ? candidates[0][0] : null;
}

export function detectReplyLanguage(defaultLang, message) {
  const fallback=["ru","tj","uz"].includes(defaultLang) ? defaultLang : "ru";
  const s=String(message||"").toLowerCase().normalize("NFKC").slice(0,700);
  if(!s.trim()) return fallback;
  const explicit=explicitlyRequestedLanguage(s);
  if(explicit) return explicit;
  // Characters unique to either language take priority over weak keywords.
  if(/[ў]/u.test(s)) return "uz";
  if(/[ҷӣӯ]/u.test(s)) return "tj";
  const tokens=new Set(s.match(/[\p{L}\p{M}]+/gu)||[]);
  const scores=Object.entries(LEXICON).map(([lang,lexicon])=>({
    lang,score:lexicon.reduce((n,word)=>n+Number(tokens.has(word)),0)
  })).sort((a,b)=>b.score-a.score);
  if(scores[0].score>0 && scores[0].score>scores[1].score) return scores[0].lang;
  // «Салом» and meaningless filler are shared/ambiguous: keep chat language.
  return fallback;
}

export function isConversationalTurn(message) {
  const s=String(message||"").toLowerCase().normalize("NFKC").trim();
  if(!s || s.length>160) return false;
  if(explicitlyRequestedLanguage(s)) {
    // A language request combined with a product/payment question still needs KB.
    return !/(?:оплат|пардохт|тўлов|тулов|подпис|обуна|аккаунт|карта|пул|ишлама|ошиб|ошибка|хато|баг|error|payment|refund|account)/u.test(s);
  }
  return /^(?:салом(?:\s+алейкум)?|ассалому\s+алайкум|salom(?:\s+aleykum)?|assalomu\s+alaykum|привет|здравствуйте|добрый\s+(?:день|вечер|утро)|hello|hi)[\s!?.…]*$/u.test(s) ||
    /^(?:рахмат|раҳмат|ташаккур|спасибо|спс|thanks|thank\s+you)[\s!?.…]*$/u.test(s) ||
    /^(?:э{2,}|е{3,}|а{3,}|эм+|хм+|мм+)[\s!?.…]*$/u.test(s);
}

// Graceful low-cost fallback only for non-factual conversational exchanges.
export function conversationalFallback(message,lang) {
  if(!isConversationalTurn(message)) return null;
  const s=String(message||"").toLowerCase().normalize("NFKC").trim();
  const messages={
    uz:{language:"Албатта! 😊 Ўзбек тилида суҳбатлашамиз. HSK AI бўйича қандай ёрдам керак?",
      hello:"Салом! 👋 HSK AI бўйича қандай ёрдам керак?",
      thanks:"Арзимайди! Яна саволингиз бўлса, ёзинг.",
      filler:"Тинглаяпман 🙂 HSK AI бўйича саволингизни ёзинг."},
    tj:{language:"Албатта! 😊 Ба забони тоҷикӣ суҳбат мекунем. Дар бораи HSK AI чӣ кӯмак лозим?",
      hello:"Салом! 👋 Дар бораи HSK AI чӣ кӯмак лозим?",
      thanks:"Марҳамат! Агар саволи дигар бошад, нависед.",
      filler:"Мешунавам 🙂 Саволи худро дар бораи HSK AI нависед."},
    ru:{language:"Конечно! 😊 Можем общаться по-русски. Чем помочь с HSK AI?",
      hello:"Здравствуйте! 👋 Чем помочь с HSK AI?",
      thanks:"Пожалуйста! Если будут ещё вопросы, напишите.",
      filler:"Я на связи 🙂 Напишите ваш вопрос о HSK AI."}
  };
  const m=messages[lang]||messages.ru;
  if(explicitlyRequestedLanguage(s)) return m.language;
  if(/^(?:рахмат|раҳмат|ташаккур|спасибо|спс|thanks|thank\s+you)/u.test(s)) return m.thanks;
  if(/^(?:э{2,}|е{3,}|а{3,}|эм+|хм+|мм+)/u.test(s)) return m.filler;
  return m.hello;
}

export function languageGuide(lang) {
  if(lang==="tj") return [
    "MANDATORY REPLY LANGUAGE: Tajik (Тоҷикӣ), Cyrillic. Do not answer in Uzbek or Russian.",
    "Correct Tajik wording example (style only): «Лутфан, ин бахши барномаро санҷед.»",
    "Use Tajik phrasing: барои, забони, омӯзиш, метавонед, шумо, чист, чаро, аст.",
    "Avoid Uzbek words: бу, учун, ўрганиш, тилини, бўлиб, қилинг."
  ];
  if(lang==="uz") return [
    "MANDATORY REPLY LANGUAGE: Uzbek (Ўзбекча), Cyrillic. Do not answer in Tajik or Russian.",
    "Correct Uzbek wording example (style only): «Илованинг ушбу бўлимини текшириб кўринг.»",
    "Use Uzbek phrasing: учун, тили, ўрганиш, мумкин, сиз, қандай, нима.",
    "Avoid Tajik words: барои, забони, метавонед, барномаест, аст."
  ];
  return [
    "MANDATORY REPLY LANGUAGE: Russian in Cyrillic script (Русский). Do not answer in Tajik or Uzbek.",
    "Correct Russian wording example (style only): «Проверьте этот раздел приложения.»"
  ];
}

// Conservative rejection of obviously wrong-language outputs.
// Ambiguous short text is allowed; this never translates or rewrites an answer.
export function isObviouslyWrongLanguage(lang, answer) {
  const s=String(answer||"").toLowerCase();
  // The model can sometimes produce fluent Russian even for an Uzbek/Tajik
  // request. Reject clearly Russian boilerplate instead of showing it.
  const words=new Set(s.match(/[\p{L}\p{M}]+/gu)||[]);
  const russian=["уточните","пожалуйста","ваш","вопрос","если","нужна","проверка",
    "аккаунта","помощь","человека","отправьте","можем","общаться","конечно",
    "напишите","могу","помочь","чем","здравствуйте","привет","спасибо","поддержка"];
  if(lang!=="ru" && russian.filter(w=>words.has(w)).length>=2) return true;
  if(lang==="ru") return /[ўғқҳҷӣӯ]/u.test(s);
  if(lang==="tj") return /[ўғ]/u.test(s) ||
    /(?:^|[^\p{L}])(бу|учун|тилини|ўрганиш|бўлиб|мўлжалланган|қилинг|кўринг)(?=$|[^\p{L}])/u.test(s);
  if(lang==="uz") return /[ҷӣӯ]/u.test(s) ||
    /(?:^|[^\p{L}])(барои|забони|метавонед|барномаест|лутфан)(?=$|[^\p{L}])/u.test(s);
  return false;
}
