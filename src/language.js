// Deterministic hints for RU/TJ/UZ. Deep-link locale remains the fallback;
// explicit language in a user's latest message overrides the saved locale.
export function detectReplyLanguage(defaultLang, message) {
  const text=String(message || "").toLowerCase().normalize("NFKC").slice(0,700);
  if (!text) return defaultLang || "ru";
  if (/[ҷӣӯ]/u.test(text)) return "tj";
  if (/[ўғ]/u.test(text)) return "uz";
  if (/(?:^|[^\p{L}])(чист|чаро|пардохт|барнома|намекунад|куҷо|ҳаст|метавонам|шумо|лутфан|забони|салом)(?=$|[^\p{L}])/u.test(text)) return "tj";
  if (/(?:^|[^\p{L}])(нима|қандай|қаерда|қайси|мен|ишламаяпти|очилмаяпти|олмайман|кираман|илова|хато|тулов)(?=$|[^\p{L}])/u.test(text)) return "uz";
  if (/(?:^|[^\p{L}])(что|как|где|почему|когда|приложение|ошибка|оплата|войти|могу|подписка|здравствуйте|помогите)(?=$|[^\p{L}])/u.test(text)) return "ru";
  return ["ru","tj","uz"].includes(defaultLang) ? defaultLang : "ru";
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
    "MANDATORY REPLY LANGUAGE: Russian (Русский), Cyrillic. Do not answer in Tajik or Uzbek.",
    "Correct Russian wording example (style only): «Проверьте этот раздел приложения.»"
  ];
}

// Conservative rejection of obviously wrong-language outputs.
// Ambiguous short text is allowed; this never translates or rewrites an answer.
export function isObviouslyWrongLanguage(lang, answer) {
  const s=String(answer||"").toLowerCase();
  if(lang==="ru") return /[ўғқҳҷӣӯ]/u.test(s);
  if(lang==="tj") return /[ўғ]/u.test(s) ||
    /(?:^|[^\p{L}])(бу|учун|тилини|ўрганиш|бўлиб|мўлжалланган|қилинг|кўринг)(?=$|[^\p{L}])/u.test(s);
  if(lang==="uz") return /[ҷӣӯ]/u.test(s) ||
    /(?:^|[^\p{L}])(барои|забони|метавонед|барномаест|лутфан)(?=$|[^\p{L}])/u.test(s);
  return false;
}
