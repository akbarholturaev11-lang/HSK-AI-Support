# HSK AI Support — V2 архитектура режаси

**Сана:** 2026-11-06
**Ҳолат:** DRAFT — архитектура муҳокамада. ChatGPT Scheduled Agent ишга қўйилди; Cloudflare R2 private bucket ва Worker KB binding тайёр; биринчи 7 бўлимли English knowledge sync бажарилган. AI Gateway захира қисми ҳали муҳокамада.
**Қамров:** фақат HSK AI Support Bot. Асосий HSK AI Railway/PostgreSQL серверига сўров юборилмайди.

## 1. Тасдиқланган қарорлар

1. Бот Telegram’даги мавжуд FAQ, 24/7 мурожаат қабул қилиш, typing, Reply оператор жавоблари, ticket ва /close механизмларини сақлайди.
2. AI’ни битта жойдан алмаштирамиз: Cloudflare AI Gateway + Dynamic Routing. Бирламчи — Cloudflare Workers AI’нинг бепул Neuron квотаси, захира — битта ташқи AI провайдери.
3. R2 Standard — English маҳсулот маълумотларини мавзулар бўйича қисқа JSON файлларда сақлаш; D1 — тикетлар, лимит ва керак бўлса қидирув индекси. GitHub Scheduled Agent ўзгариш бўлганда автоматик янгилайди.
4. Билимлар базаси **битта English каноник тилда** сақланади. Ҳар ҳужжатда ru/tj/uz таржималари ёки lang майдони бўлмайди. AI фойдаланувчига унинг тилида жавоб беради. Кириш ҳаволасидан тилни билиш сақланади, лекин user бошқа тилда ёзса жавоб ўша тилга ўтади. Тил танлаш экрани йўқ.
5. Чекланган AI: 1–2 қисқа жумла, одатда 220 белгидан узун эмас. Асоссиз тўлов тасдиғи, қайтарим, аккаунт текшируви ёки баг тузатилганини айтиш тақиқ.
6. Gateway ёрдамида мос провайдерлар моделини конфигурация орқали алмаштириш. Бошқа API протоколидаги ҳар қандай модель учун 100% автоматик мослик ваъда қилинмайди — баъзан адаптер керак.
7. Иккала AI ишламаса бот тўхтамайди: маълумотли FAQ ёки операторга ticket. Скриншотлар AI’га эмас, операторга.
8. Фойдаланувчининг шахсий аккаунт, тўлов ва хабар маълумотлари KB’га ёзилмайди. R2 private, API калитлари фақат Secret.

## 2. Архитектура ва ягона созлаш нуқтаси

Telegram → Cloudflare Worker → FAQ/intent → D1 index → R2 дан мос 1–3 English ҳужжат → AI Gateway route → Telegram қисқа жавоб.

**Q12 — ТАСДИҚЛАНДИ (A):** Cloudflare AI Gateway Dashboard — асосий модель, захира модель, провайдер, route ва gateway-level лимитни бошқарадиган ягона интерфейс. Admin PWA/Telegram'дан API ўзгартириш интерфейси қурилмайди. Махфий калитлар Gateway BYOK/Secrets Store ёки мувофиқ бўлса Unified Billing орқали бошқарилади. Worker фақат битта нормализацияланган generateAnswer() интерфейсини чақиради.

**Мажбурий техник текширув:** Cloudflare Workers AI Gateway орқали чақирилганда бепул квота қандай ҳисобланади? Квота тугаганда қандай сигнал қайтарилади? Gateway Dynamic Route ташқи моделга ҳақиқатан fallback қиладими? Қандай ҳолатда билмасдан пуллик billing ишга тушиши мумкин? Агар бу шартларни ишончли таъминлаб бўлмаса, Cloudflare native Workers AI primary ва Gateway backup’ни бирлаштирувчи жуда кичик Worker router қилинади, лекин модел номлари ягона конфигурациядан келади.

## 3. R2 Knowledge Base — автоматик ChatGPT агент

**ЯНГИ ТАСДИҚЛАНГАН ҚАРОР:** Маълумотни ҳар бир ўзгаришда қўлда owner тасдиқлаши шарт эмас. **Q10/B:** `main`'га кирган user-facing код ўзгариши учун release/deploy текшириш босқичи ҳам талаб қилинмайди. Битта ChatGPT Scheduled Agent `HSK-AI-Bot/main` ни **ҳар 4 соатда** текширади. Мавжуд билимлар базасидаги фактлар ўзгармаган бўлса, **ҳеч қандай файлни қайта ёзмайди**.

### Ҳар бир циклда аниқ 5 ҳаракат

1. GitHub `akbarholturaev11-lang/HSK-AI-Bot` репозиторийсининг ҳозирги `main` commit SHA'сини олади; Support KB'да охирги текширилган SHA билан солиштиради.
2. SHA ўзгармаган бўлса — **тўхтайди, R2'га тегмайди, фойдаланувчига хабар юбормайди**.
3. SHA ўзгарган бўлса — фақат янги commit diff'ларини ва зарур бўлса тегишли янги код/қоидаларни ўқийди. Бутун катта репозиторийни ҳар сафар қайта таҳлил қилмайди.
4. Фойдаланувчига тегишли **текшириб бўладиган маҳсулот қоидаси** ўзгарган бўлса, фақат шу бўлимнинг English JSON файлини янгилайди. Ботга тегишли бўлмаган рефактор, тест, internal-only ўзгаришларига тегмайди.
5. Янгиланган KB файли ва охирги текширилган SHA GitHub'да қайд қилинади, R2 билан автоматик sync қилинади. R2 ишга тушгунча GitHub — staging source; ишга тушганидан кейин автоматик publish, owner approval йўқ.

### Содда R2 тузилиши

- `kb/payments.json`
- `kb/subscriptions.json`
- `kb/accounts.json`
- `kb/android.json`
- `kb/pwa.json`
- `kb/telegram.json`
- `kb/general.json`

Бир мавзуда фактлар жуда кўпайса, кейин кичик файлларга бўлинади. **Q13 қабул қилинди (A):** ҳар topic учун 1 та асосий файл + 1 та аввалги backup версия сақланади. Фақат content ўзгарганда ҳозирги файл backup'га кўчирилади, сўнг янги версия ёзилади. Хато янгиланишда backup'дан rollback қиламиз. Draft/approved workflow, қўл тасдиғи, узун версия тарихи йўқ. **Эслатма:** бу ҳозирча режа, R2'да эски версияни сақлаш коди ҳали ишга туширилмаган.

Ҳар JSON: `topic`, `facts` (текширилган фактлар), `source_commit`, `updated_at`. `lang` йўқ. Файлнинг ўзгариш вақти фақат ҳақиқий content ўзгарганда янгиланади. Таржима дубликати сақланмайди — AI user ёзган тилга мослашади.

**Q10 — тасдиқланган B қоидаси:** Агент `HSK-AI-Bot/main`'даги user-facing код ўзгаришини кўрса, алоҳида production deployment тасдиғини кутмасдан KB'ни янгилайди. Фақат кодда аниқ кўринган факт ёзилади; фақат режа/TODO, рефактор ёки ноаниқ тахминлар фактический имконият сифатида ёзилмайди. **Огоҳлантириш:** `main`'даги функция release қилинмаган ёки feature flag ортида бўлиши мумкин; бу танлов фойдаланувчига муддатидан аввал маълумот бериш хавфини қабул қилади.

**Боғланиш:** ChatGPT Scheduled Agent → GitHub HSK-AI-Bot/main diff → Cloudflare connector орқали private R2 bucket'га фақат ўзгарган JSON файллар. GitHub Actions ва алоҳида API token/CI pipeline керак эмас. R2'да `knowledge/sync_state.json` checkpoint сақланади. Worker private `KB` R2 binding орқали файлларни ўқий олади; маълумотли retrieval ҳали V2 кодга уланиши керак. Тикетлар D1'да қолади.

**Агент:** ChatGPT Schedule'да `HSK AI KB Sync` фаол, ҳар 4 соатлик main SHA/diff текширув. R2 API'га бевосита ёзади. KB'да янги факт бўлмаса файл ва хабар ўзгармайди. Фақат R2 файлларининг барча upload'лари муваффақиятли ўтса `knowledge/sync_state.json` checkpoint янгиланади.

**Реал ҳолат:** Cloudflare R2 фаол. `hsk-ai-support-kb` private bucket (Standard, EEUR) яратилган, `knowledge/sync_state.json` бошланғич ҳолатда ёзилган (`last_checked_sha: null`). Cloudflare Support Worker'да `KB` binding бор. Биринчи baseline main SHA `c8c1aaf5b2b07b40878017ae8f6bb7a60da4b073` асосида 7 та English KB JSON яратилди, ҳар бири R2'га ёзилди ва қайта ўқиб текширилди. `knowledge/sync_state.json` ушбу SHA билан `synced` бўлди. Кейинги **режали** автоном цикл ҳали алоҳида тасдиқланмаган.

## 4. R2 билимларини AI жавобларига улаш — ҲАЛИ АМАЛГА ОШИРИЛМАГАН

**Реал ҳолат:** private `hsk-ai-support-kb` bucket'да 7 та English topic JSON бор ва Worker'да `KB` binding мавжуд. Лекин ҳозирги `src/index.js` да `askAi()` R2'дан маълумот ўқимайди: AI ҳали код ичидаги умумий `FACTS` билан ишлайди. **R2'га улангани AI ундан фойдаланяпти дегани эмас.**

Кейинги код босқичи:
1. Фойдаланувчининг саволини ва мавжуд кириш манбасини ўқиш; аниқ FAQ бўлса AI/R2 чақирмасдан жавоб бериш.
2. Мос мавзуни аниқлаш. Бошланғич 7 та JSON учун енгил мавзули keyword map етади; ҳар сўровда катта index/embedding/алохида AI classifier шарт эмас.
3. Worker `env.KB.get("knowledge/{topic}.json")` орқали 1 ёки зарур бўлса 2 та English файлни ўқийди. Керакли файл йўқ ёки манба аниқ бўлмаса — operator ticket, фактни ўйлаб топиш йўқ.
4. Фақат танланган, хавфсиз фактларни AI'га контекст қилиб узатади. Жавоб фойдаланувчи ёзган тилда, 1–2 қисқа жумла бўлади.
5. Мавзу қидириш ортиқча хатолар берса ёки KB катталашса, кейин D1 keyword index вариантга ўтиш мумкин. Ҳозирча D1 тикет ва лимит вазифасида қолади.
6. Релиздан олдин test: тўлов/аккаунт/Android/PWA/Telegram мавзулари, KB R2 хато, AI fallback, 3 тил, operator Reply ва /close. Хавфсиз rollback.

**Q17 — ЕЧИЛДИ: A варианти фойдаланувчи томонидан аниқ тасдиқланган.**
- **ТАНЛАНДИ (A):** Worker'да оддий keyword→topic map, 7 та бўлимдан 1–2 файлини ўқиш. Ортиқча D1 search ва AI classifier керак эмас. Ноаниқ бўлса фойдаланувчидан қисқача аниқлаштириш ёки операторга ўтиш.
- B: D1 index орқали keyword/tag қидириш, 1–3 файл. KB ўсса фойдали; ҳозир ортиқча мураккаблик.
- C: AI аввал қайси файл кераклигини танлайди. Тилни тушуниши кучли, аммо қўшимча AI чақируви, латентлик ва харажат бор.

**Келишув қоидаси:** Муҳокама пайтида сен саволга жавоб бермасдан кейингисига ўтсанг, тавсия қилинган вариант **режада қабул қилинган default** деб қайд этилади. Фикрингни кейин ўзгартиришинг мумкин. Бу қоида **пуллик API billing, махфий калит, production deploy ёки бошқа таъсирли ҳаракатга ўз-ўзидан рухсат** ҳисобланмайди.

## 4.1. Фото/скриншот ва AI Vision — мажбурий V2 функцияси

**Ҳозирги код ҳолати:** `src/index.js`'да Telegram `message.text` бўлмаса, `handlePrivate()` `forwardToOperator()`'га ўтади. Расм ва унинг caption'и `copyMessage` орқали оператор гуруҳига боради; админ `copyMessage` билан user'га фото/матн қайтариши мумкин. **AI расмни таҳлил қилмайди.** Бу функция V2 реализациясида алоҳида қўшилади.

**Қарор: фойдаланувчининг расми ва хатолик скриншотини автоматик AI Vision таҳлил қилади; ишончсиз/ишламаса операторга ўтказади.** Янги алоҳида модель ёки OCR сервиси шарт эмас: асосий `@cf/google/gemma-4-26b-a4b-it` модель vision support қилади (Cloudflare расмий model docs), захира `minimax/m3.1-flash` ҳам image input қила олади (Cloudflare catalog). Иккала model'га ҳам ҳақиқий расм payload қабул қилиниши ва ишлаши staging тестда исботланиши керак; capability борлиги production интеграцияси тайёр дегани эмас.

**Содда амалий оқим:**
1. Telegram'дан `photo` (зарур бўлса JPG/PNG image `document`) ва `caption`ни қабул қилиш; `getFile` орқали тасдиқланган Telegram файлини HTTPS билан юклаш. MIME, ҳажм ва timeout чегарасини текшириш; нотўғри/катта файлни операторга узатиш.
2. Расм + caption/қисқа аввалги контекстни AI'га узатиб, HSK AI'даги экранни/хатони/оғзаки матнни тушуниш; керакли мавзуга мос 1–2 R2 KB JSON фактлари билан текшириш. Фақат расмда кўринаётган нарса асосида 1–2 қисқа жумла ва керак бўлса битта аниқловчи савол; бошқа user маълумотини тахмин қилмаслик.
3. Ишончсиз, экран ноаниқ, model error, quota/бюджет тугаган, ёки user оператор сўраган бўлса — мавжуд `forwardToOperator()` ва `copyMessage()` орқали **расмнинг ўзини** операторга етказиш. Бир user учун бир неча тикет очмаслик.
4. **Қоида:** битта image AI таҳлили ҳам кунлик 20 AI саволи лимитига киради; расм учун алоҳида пуллик модель автоматик ёқилмайди. Аниқ FAQ ва операторга юбориш quota'га кирмайди. Cloudflare/MiniMax умумий бюджет назорати сақланади.
5. **Махфийлик:** расм, Telegram `file_id`, raw OCR матни ёки screenshot data'ни R2 билимлар базасига ёзмаслик; логларда расмнинг мазмуни, токен, карта, email, шахсий маълумот бўлмасин. Модельга узатишда сезгир маълумот хавфини камайтириш; тўлов чекидан «тўлов тасдиқланган» деган хулосани AI мустақил чиқармасин — аккаунт ва тўлов статуси фақат ишончли манбадан ёки оператор текшируви билан.
6. **Тест:** Telegram фото caption билан/сиз, screenshot error, UI language, оғир ва бузуқ файл, quota, MiniMax backup image support, user->operator `copyMessage`, admin photo reply, RU/TJ/UZ, sensitive-data leak; AI ишламаганда ҳозирги photo-to-operator йўли бузилмаслиги шарт.

Расмий model маълумотлари: https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/ ва https://developers.cloudflare.com/ai/models/minimax/m3.1-flash/ .

## 5. AI fallback, нарх ва хавфсизлик

**Қабул қилинган охирги fallback (Q11):** фойдаланувчи **A — AI иккала провайдерда ҳам ишламаса автоматик Telegram операторга ticket + қисқа статус** вариантини танлади. Очиқ тикет бўлса янгисини кўпайтирмасдан унга бириктириш керак. Production V2 кодда ҳали жорий қилинмаган.


**Қабул қилинган суҳбат контексти (Q9):** **B — сўнгги 5 та хабар, 1 соат**. Хабарларга user ва AI жавоблари киради; шахсий маълумотлар ва токенлар чиқариб ташланади. TTL ўтгач вақтинчалик контекст ўчирилади; raw dialog'ни R2 билимлар базасига ёзмаймиз. Бу фақат V2 режаси, live кодга ҳали жорий этилмаган.


**Қабул қилинган кунлик AI лимити (Q8):** фойдаланувчи C вариантини танлади — **20 та AI саволи/кун**. Оддий FAQ, операторга мурожаат ва оператор жавоблари бу ҳисобга кирмайди. Cloudflare free квотаси ва MiniMax захира бюджети устувор хавфсизлик чегаралари; улар тугаса AI ўрнига операторга ўтилади. Бу ҳозирча фақат V2 режаси, live коддаги лимит ўзгартирилмаган.


**Қабул қилинган billing танлови (Q6):** MiniMax M3.1 Flash захира модели учун Cloudflare AI Gateway **Unified Billing** (A варианти). Фойдаланувчи аниқ тасдиқлади; BYOK танланмади. Q7 бўйича бюджет тасдиқланган: $0.20/кун, $3/ой. Бу billing'нинг кафолатланган қатъий чегараси эмас; техник назорат ва тўлов лимитлари текширилиши шарт. Auto top-up OFF, бюджет сигналлари, сарф аудити ва fallback тестларидан олдин пуллик endpoint production'га уланмайди. Бу танлов ҳозирча Cloudflare'да кредит харид қилиш ёки billing'ни ёқишни англатмайди.


**Захира модель фойдаланувчи танлови билан аниқланди (Q5):** MiniMax M3.1 Flash. Cloudflare Unified API model ID: `minimax/m3.1-flash`; MiniMax direct API ID: `MiniMax-M3.1-Flash`. Cloudflare расмий каталогида 2026-11-06 кўрсатилган нарх: input $0.15/M, output $0.60/M, cached input $0.015/M. Модель always-on reasoning қилади, шу сабаб паст effort, 220 белгили жавоб, timeout ва тил сифати текширилмагунча production'га уланмайди. API калити ва billing ҳали йўқ. Манба: https://developers.cloudflare.com/ai/models/minimax/m3.1-flash/


- Primary: Cloudflare Workers AI free quota. Secondary: битта танланган ташқи provider.
- Fallback: quota/429, 5xx, timeout, provider unavailable каби техник сабабларда. Далилсиз саволга жавоб йўқлигида бошқа модель фантазия қилишга чақирилмайди.
- Бир мурожаат учун максимум 1 primary + 1 backup AI чақируви; ишламаса operator ticket.
- User/day ва global лимитлари қайта белгиланади; ҳозирги 3/user ва 60/global қийматлари доимий тасдиқланган қоида эмас.
- Жавоб чеклови: 1–2 жумла ва 220 белги; RU/TJ/UZ end-to-end текширув.
- API credentials GitHub’да ёки R2 ҳужжатларида бўлмайди. AI Gateway logging request body, username, Telegram ID, PII бўйича privacy review.
- Provider/model, quota error, fallback trigger, latency, approximate cost каби метрикаларни user матнисиз сақлаш.
- Захира харажати учун кунлик/ойлик лимит ҳам provider, ҳам Gateway/Worker даражасида текширилади. Дастурий ҳисоб-китобни ҳақиқий billing hard cap деб ҳисобламаймиз.

## 6. Тасдиқдан кейинги амалий босқичлар

**Phase 0 — freeze/audit:** production Worker версияси, D1 ва Secrets binding’ларини қайд қилиш; бот /start, FAQ, typing, медиа, Reply, /close ва 3 тил smoke-test; rollback.

**Phase 1 — universal AI router:** Gateway route, модели алмаштириш, paid backup, privacy/budget, error/fallback simulation; Cloudflare free квотаси воқеий текширилади. Фақат синовдан сўнг release.

**Phase 2 — R2 → AI integration ва image vision:** R2 private bucket, 7 English topic JSON ва Worker `KB` binding тайёр. Worker’га 1–2 мос файлни танлаб ўқиш, AI'га grounded context бериш ва ишончсиз ҳолатда operator’га ўтиш кодини алоҳида қўшиш керак. Ҳозир бунда implementation йўқ. GitHub Actions pipeline талаб қилинмайди.

**Phase 3 — ChatGPT Scheduled Agent:** ҳар 4 соатда HSK-AI-Bot/main SHA ва diff текшируви → фақат текширилган user-visible ўзгаришни тегишли English файлда Cloudflare R2 API орқали ёзади. Ўзгариш йўқ бўлса ҳеч нарса қилмайди; owner approval йўқ. Агент schedule'и фаол; дастлабки KB синхронизацияси жорий чатда бажарилди, кейинги мустақил режали цикл ҳали текширилмаган.

**Phase 4 — rollout:** CI, staging, камида 30 та RU/TJ/UZ сценарий-тест, quota/timeout/invalid token/cost tests, операторга тўғри ўтиш, мониторинг. Production deployment фақат owner тасдиғи ва rollback варианти билан.

## 6.1. Техник саволлар бўйича мутахассис қарори (Q15–Q16)

- **Q15:** биргина `Cloudflare AI Gateway` router. Supported model/provider'лар Dashboard route конфигурацияси орқали танланади; бу йўлда Worker'нинг Telegram logic'ини қайта ёзиш шарт эмас. Агар келажакда model API формати Gateway билан мос келмаса, `provider adapter` алоҳида қатламда ёзилади. **Ҳар бир моделни мутлақ кодсиз улаш мумкин деган кафолат йўқ.**
- **Q16:** техник ижрочи 10 та ҳақиқий Support сценарийни тузади (тўлов, обуна, аккаунт, Android, PWA, Telegram, умумий маълумот, лимит, fallback, операторга ўтиш); ҳар бирини узбек, тожик, рус тилларида синаб, камида 30 та тест ҳолати бажаради. Фактлар ва статуслар KB'га тўғри мос бўлиши; бот ўзида йўқ маълумотни ўйлаб топмаслиги; токен/карта/PII чиқмаслиги; жавоб тили тўғри бўлиши; техник fallback ва оператор тикети ишлаши шарт. Хатолар топилса тузатиш ва қайта тест, кейин QA ҳисоботи. Финал release инсон тасдиғисиз қилинмайди; owner'га фақат тайёр натижа ва муҳим қарорлар тақдим этилади.

## 7. Acceptance criteria

- HSK AI Railway серверига Support’дан 0 сўров.
- Модел ва backup алмашиш Telegram кодини таҳрирламасдан мумкин.
- FAQ AI/R2сиз; KB сўрови максимум 1–3 R2 ҳужжат.
- KB бир тилда, текширилган main кодга таянган ва source_commit'ли. Таржима дубликатлари йўқ; файл фақат факт ўзгарганда қайта ёзилади.
- Free AI quota exhaustion ҳолатида захира ишлайди; у ҳам ишламаса Telegram операторга ticket келади.
- Фото/скриншот AI Vision билан текширилади, R2 KB'га асосланиб қисқа жавоб берилади; image vision ишламаса асл сурат operator'га юборилади. Расм KB/R2'га сақланмайди, payment approval AI'дан қилинмайди.
- Ботнинг мавжуд Reply, /close, фото, deep-link, typing ва webhook имкониятлари бузилмайди.
- Лимит, харажат, AI хатолари ва rollback амалда текширилган.

## 8. Муҳокама учун ОЧИҚ қарорлар

**Муҳокама қоидаси:** ҳар савол бўйича 2–3 та содда вариант ва **аниқ тавсия** берилади; сен жавоб бермасдан кейингисига ўтсанг, тавсияни режа учун танланган default деб ҳисоблаймиз. Кейин ўзгартириш мумкин. Бироқ жим қолиш — пулли хизматни ёқиш ёки production'га ўзгариш жойлаштиришга рухсат эмас.

| ID | Савол | Таклиф (тасдиқланмаган) |
|---|---|---|
| Q4 (ЕЧИЛГАН) | Биринчи KB қамрови | 7 та бўлим R2’да яратилди: payments, subscriptions, accounts, android, pwa, telegram, general. |
| Q17 (ЕЧИЛГАН) | R2'дан файл танлаш | **A — Worker'да keyword→topic map, максимум 1–2 English файл.** Фойдаланувчи аниқ танлади. |
| Q5 (ЕЧИЛГАН) | Захира AI модели | **MiniMax M3.1 Flash** танланди. Cloudflare Gateway model ID `minimax/m3.1-flash`; direct MiniMax API model ID `MiniMax-M3.1-Flash`. Нархи (2026-11-06): $0.15/1M input, $0.60/1M output. Reasoning доимий: паст effort/timeout ва RU/TJ/UZ тестлари керак. Пуллик API ҳали уланмаган. |
| Q6 (ЕЧИЛГАН) | MiniMax захира API ҳисоб-китоби | **A — Cloudflare Unified Billing**, фойдаланувчи аниқ тасдиқлади. Cloudflare Dashboard орқали бошқариш, auto top-up OFF ва budget alert/limit; 5% кредит қўшимча ҳақи эҳтимоли ҳисобга олинади. Billing ҳали фаоллаштирилмаган, кредит сотиб олинмаган. |
| Q7 (ЕЧИЛГАН) | MiniMax захира AI харажат чегараси | **A танланди: $0.20/кун ва $3/ой.** Ойлик $3 бюджет устувор. Auto top-up OFF; monitoring ва app-level cutoff; Cloudflare/provider billing hard cap эканлиги алоҳида текширилади. Ҳали кредит сотиб олинмаган. |
| Q8 (ЕЧИЛГАН) | Фойдаланувчига кунлик AI савол лимити | **C — 20 та AI саволи/кун**, фойдаланувчи аниқ тасдиқлади. FAQ ва оператор билан алоқа лимитга кирмайди. Global Cloudflare Neuron квотаси ва MiniMax $0.20/кун, $3/ой бюджети сақланади; бу production'да ҳали жорий қилинмаган. |
| Q9 (ЕЧИЛГАН) | AI суҳбат хотираси | **B — сўнгги 5 та хабар (user + AI), 1 соат.** Фойдаланувчи аниқ тасдиқлади. Фақат вақтинчалик, керакли контекст; шахсий/махфий маълумот сақланмайди, TTL тугагач тозаланади. Ҳали production'да йўқ. |
| Q10 (ЕЧИЛГАН) | `main` ўзгариши қачон KB'га киради? | **B — `HSK-AI-Bot/main`'га қўшилиши билан**, release/deploy далилини кутиш шарт эмас. User аниқ танлади. Хавф: ҳали ишга тушмаган feature ҳақида AI эрта маълумот бериши мумкин. Фақат user-facing код ўзгариши ва тўғри мазмун олинади; TODO/plan/refactor киритилмайди. |
| Q11 (ЕЧИЛГАН) | Cloudflare AI ва MiniMax иккаласи ҳам ишламаса | **A — фойдаланувчига қисқа хабар ва автоматик оператор тикети.** Фойдаланувчи аниқ тасдиқлади; чексиз retry ва жавобсиз қолдириш йўқ. Мавжуд очиқ тикет бўлса шу тикетга улаш, такрорий тикет очмаслик. |
| Q12 (ЕЧИЛГАН) | AI модель ва API бошқариш жойи | **A — Cloudflare AI Gateway Dashboard**, фойдаланувчи аниқ тасдиқлади. Primary/backup модели, route ва billing назорати битта жойда; Admin PWA ва Telegram админ командалари MVP'да керак эмас. Ҳозирги production конфигурация ўзгартирилмаган. |
| Q13 (ЕЧИЛГАН) | R2 билим файллари версиялари | **A — 1 та фаол файл + 1 та аввалги backup**; фойдаланувчи тасдиқлади. Фақат ҳақиқий ўзгаришда backup олинади; хато бўлса rollback. Бу ҳали режа, R2да backup механизми жорий қилинмаган. |
| Q14 (ЕЧИЛГАН) | Telegram оператор KB ўзгартира оладими? | **A — йўқ.** Фойдаланувчи аниқ тасдиқлади. KB фақат GitHub `HSK-AI-Bot/main` → ҳар 4 соатлик ChatGPT агенти орқали янгиланади. Оператор фақат фойдаланувчи мурожаатига жавоб беради. |
| Q15 (ЕЧИЛГАН — техник қарор) | Бошқа AI моделини қўшиш | **A — Cloudflare AI Gateway орқали ягона router**. Gateway қўллаб-қувватлайдиган provider/model конфигурацияси Dashboard'да алмаштирилади; native API мос келмаса фақат ўша provider учун кичик adapter. Telegram handler'ларда provider-specific код йўқ. Мутахассислик қарори, owner учун қўшимча вазифа йўқ. |
| Q16 (ЕЧИЛГАН — техник қарор) | RU/TJ/UZ жавобларни қабул қилиш | **Автоматлаштирилган 30+ та тест (камида 10 та реал сценарий × 3 тил) + техник аудит**. Факт хатоси ва шахсий маълумот чиқиши: 0; тил ва қисқалик/операторга эскалация натижаси ҳам текширилади. Натижалар GitHub тест/QA ҳисоботида сақланади; owner'дан тил/кодни тестлаш талаб қилинмайди. Production release'га эса алоҳида розилик керак. |

**ЕЧИЛГАН:** Q1–Q17 — фақат HSK-AI-Bot/main diff, ҳар 4 соатлик ChatGPT Scheduled Agent, owner approval йўқ. **ОЧИҚ ТЕХНИК САВОЛ ҚОЛМАДИ.** Q15 ва Q16 мутахассис томонидан ҳал қилинди. Шу пайтгача AI Gateway billing ва KB retrieval production'га қўшилмайди; R2 bucket ва KB binding аллақачон яратилди. Қолганларига тавсияни қабул қилиш ёки ўзгартириш мумкин. Тасдиқдан олдин ишга туширилмайди.

## 9. Ҳозир бажарилмайдиган ишлар

**R2 bucket ва KB Worker binding аллақачон яратилди**; бу ўзи ботнинг жавоб бериш мантиғини ўзгартирмайди. AI Gateway paid route, D1 schema migration ва KB retrieval code ҳали йўқ. Ҳозирги Support Bot одатдагидек ишлашда давом этади.

## 10. Cloudflare расмий маълумотлар

- AI Gateway REST API: https://developers.cloudflare.com/ai-gateway/usage/rest-api/
- AI Gateway Dynamic Routing: https://developers.cloudflare.com/ai-gateway/features/routing/dynamic-routing/
- Unified Billing / BYOK: https://developers.cloudflare.com/ai-gateway/features/unified-billing/
- R2 pricing: https://developers.cloudflare.com/r2/pricing/
- R2 Workers binding: https://developers.cloudflare.com/r2/get-started/workers-api/
- D1: https://developers.cloudflare.com/d1/

## 11. V2 implementation progress (2026-11-06)

- **Feature code written in PR #1, NOT deployed to production:** https://github.com/akbarholturaev11-lang/HSK-AI-Support/pull/1 .
- Added `src/knowledge.js` (R2 English topic lookup, maximum 2 documents), `src/ai-router.js` (Cloudflare Gemma 4 primary and gated MiniMax M3.1 Flash backup), `src/conversation.js` (5 sanitized messages, 1-hour TTL), updated `src/index.js` and additive D1 `support_context` schema.
- AI quota 20/user/day. Static FAQ and operator messages not limited by AI quota.
- Gateway `hsk-ai-support` created: authentication enabled, provider request/response logging disabled; MiniMax model-filtered spend rules $0.20/86400s, $3/2592000s. The second is a rolling 30-day window, not necessarily a calendar month.
- Paid backup OFF in `wrangler.toml`, no Unified Billing credits purchased. Production Worker is still running the original deployed version.
- Four-hour KB sync agent's prompt now uses main-first (Q10/B) and previous-version R2 backup (Q13/A). **Autonomous scheduled success and actual backup-restore have not yet been observed.**
- See [V2_RELEASE_CHECKLIST.md](V2_RELEASE_CHECKLIST.md) for required staging, D1 migration, real RU/TJ/UZ model evaluation, token-secret remediation, billing approval, and production rollout.
