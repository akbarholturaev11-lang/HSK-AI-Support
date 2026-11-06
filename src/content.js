export const COPY = {
  ru: {
    welcome: "Здравствуйте! 👋\nПоддержка HSK AI. Опишите проблему или выберите раздел.",
    payment: "💳 Оплата и подписка\nОпишите, что произошло: не удалось оплатить, деньги списаны или подписка не активировалась? Не присылайте номер карты, CVV, пароли и SMS-коды.",
    account: "🔐 Аккаунт и вход\nУточните, где проблема: Android, PWA, Mini App, Desktop или Telegram. Можете отправить скриншот без личных кодов.",
    bug: "🛠 Техническая ошибка\nНапишите, что не работает, устройство и версию приложения. При необходимости приложите скриншот.",
    operatorUnavailable: "👤 Оператор пока недоступен. Автоматическая помощь продолжает работать — попробуйте описать вопрос иначе.",
    opened: "✅ Обращение передано оператору. Ответ придёт сюда. Время ответа зависит от доступности оператора.",
    active: "✅ Сообщение добавлено к вашему обращению.",
    closed: "✅ Оператор закрыл обращение. Если нужна помощь снова, напишите сообщение.",
    limit: "Слишком много сообщений. Попробуйте позже.",
    buttons: ["💳 Оплата", "🔐 Аккаунт", "🛠 Ошибка", "👤 Оператор"]
  },
  tj: {
    welcome: "Салом! 👋\nДастгирии HSK AI. Мушкилотро нависед ё бахшро интихоб кунед.",
    payment: "💳 Пардохт ва обуна\nЧӣ мушкил шуд: пардохт иҷро нашуд, маблағ гирифта шуд ё обуна фаъол нагашт? Рақами корт, CVV, парол ва рамзи SMS нафиристед.",
    account: "🔐 Ҳисоб ва воридшавӣ\nМушкил дар куҷост: Android, PWA, Mini App, Desktop ё Telegram? Метавонед скриншотро бе рамзҳои шахсӣ фиристед.",
    bug: "🛠 Хатои техникӣ\nНависед чӣ кор намекунад, номи дастгоҳ ва версияи барномаро нишон диҳед. Агар лозим бошад, скриншот фиристед.",
    operatorUnavailable: "👤 Оператор ҳоло дастрас нест. Ёрии автоматӣ кор мекунад — саволро бо тарзи дигар нависед.",
    opened: "✅ Муроҷиат ба оператор фиристода шуд. Ҷавоб ба ҳамин чат меояд. Вақти ҷавоб аз дастрасии оператор вобаста аст.",
    active: "✅ Паём ба муроҷиати шумо илова шуд.",
    closed: "✅ Оператор муроҷиатро баст. Барои ёрии нав паём нависед.",
    limit: "Паёмҳо аз ҳад зиёд шуданд. Каме дертар кӯшиш кунед.",
    buttons: ["💳 Пардохт", "🔐 Ҳисоб", "🛠 Хатогӣ", "👤 Оператор"]
  },
  uz: {
    welcome: "Салом! 👋\nHSK AI ёрдам хизмати. Муаммони ёзинг ёки бўлимни танланг.",
    payment: "💳 Тўлов ва обуна\nНима бўлди: тўлов ўтмадими, пул ечилдими ёки обуна ёқилмадими? Карта рақами, CVV, пароль ва SMS-кодни юборманг.",
    account: "🔐 Аккаунтга кириш\nҚаерда муаммо: Android, PWA, Mini App, Desktop ёки Telegram? Шахсий кодларсиз скриншот юборишингиз мумкин.",
    bug: "🛠 Техник хато\nНима ишламаётганини, қурилма ва илова версиясини ёзинг. Керак бўлса скриншот юборинг.",
    operatorUnavailable: "👤 Оператор ҳозирча мавжуд эмас. Автоматик ёрдам ишлаяпти — саволни бошқача ёзиб кўринг.",
    opened: "✅ Мурожаат операторга юборилди. Жавоб шу чатга келади. Жавоб вақти операторнинг мавжудлигига боғлиқ.",
    active: "✅ Хабарингиз мурожаатга қўшилди.",
    closed: "✅ Оператор мурожаатни ёпди. Яна ёрдам керак бўлса хабар ёзинг.",
    limit: "Хабарлар жуда кўпайди. Бироз кейин қайта уриниб кўринг.",
    buttons: ["💳 Тўлов", "🔐 Аккаунт", "🛠 Хато", "👤 Оператор"]
  }
};

export const FACTS = [
  "HSK AI is a Chinese language learning product.",
  "HSK AI users may use Telegram, Android, PWA, Mini App, or Desktop.",
  "Support is offered in Russian, Tajik, and Uzbek.",
  "Do not claim to see live payments, user accounts, server logs, or subscription status.",
  "Do not invent subscription prices, refunds, release dates, fixes, or payment confirmations.",
  "If there is an individual payment, subscription, account, or technical issue requiring verification, hand off to the human operator.",
  "Never request passwords, bank card numbers, CVV, one-time SMS codes, or login tokens.",
  "This assistant is product support, not a Chinese tutor. Direct learning questions to the main HSK AI app."
];

export function menu(lang) {
  const l = COPY[lang] || COPY.ru;
  return { inline_keyboard: [
    [{ text: l.buttons[0], callback_data: "help:payment" }, { text: l.buttons[1], callback_data: "help:account" }],
    [{ text: l.buttons[2], callback_data: "help:bug" }, { text: l.buttons[3], callback_data: "help:operator" }]
  ] };
}

export function explicitFaq(text, lang) {
  const s = String(text || "").toLowerCase().trim().replace(/[!?.,]/g, "");
  const short = s.length < 65;
  if (!short) return null;
  const c = COPY[lang] || COPY.ru;
  // No verified platform-specific sign-in steps in KB yet: ask for platform
  // instead of letting the model invent Telegram ID / Google / PWA login steps.
  if (/как (?:мне )?(?:войти|зайти)|как авториз|чӣ тавр.*(?:аккаунт|ҳисоб)|аккаунт.*қандай.*кир|(?:логин|вход|ворид|кириш).*(?:pwa|iphone|android)|(?:pwa|iphone|айфон).*?(?:вход|логин|кириш)/u.test(s)) return c.account;
  if (/^(оплата|подписка|платёж|платеж|пардохт|обуна|тўлов|тулов)$/.test(s)) return c.payment;
  if (/^(аккаунт|вход|логин|ҳисоб|воридшавӣ|кириш)$/.test(s)) return c.account;
  if (/^(ошибка|баг|хато|хатогӣ|не работает)$/.test(s)) return c.bug;
  return null;
}
