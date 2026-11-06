# HSK AI Support — V2 архитектура режаси

**Сана:** 2026-11-06
**Ҳолат:** DRAFT — муҳокама учун, ҳозирча implementation ва production ўзгаришига рухсат йўқ.
**Қамров:** фақат HSK AI Support Bot. Асосий HSK AI Railway/PostgreSQL серверига сўров юборилмайди.

## 1. Тасдиқланган қарорлар

1. Бот Telegram’даги мавжуд FAQ, 24/7 мурожаат қабул қилиш, typing, Reply оператор жавоблари, ticket ва /close механизмларини сақлайди.
2. AI’ни битта жойдан алмаштирамиз: Cloudflare AI Gateway + Dynamic Routing. Бирламчи — Cloudflare Workers AI’нинг бепул Neuron квотаси, захира — битта ташқи AI провайдери.
3. Р2 (R2 Standard) — маҳсулотнинг тасдиқланган маълумотларини мавзулар бўйича кичик файлларда сақлаш; D1 — файл индекси, фаол версия, тикетлар, лимит ва техник статистика.
4. Билимлар базаси **битта English каноник тилда** сақланади. Ҳар ҳужжатда ru/tj/uz таржималари ёки lang майдони бўлмайди. AI фойдаланувчига унинг тилида жавоб беради. Кириш ҳаволасидан тилни билиш сақланади, лекин user бошқа тилда ёзса жавоб ўша тилга ўтади. Тил танлаш экрани йўқ.
5. Чекланган AI: 1–2 қисқа жумла, одатда 220 белгидан узун эмас. Асоссиз тўлов тасдиғи, қайтарим, аккаунт текшируви ёки баг тузатилганини айтиш тақиқ.
6. Gateway ёрдамида мос провайдерлар моделини конфигурация орқали алмаштириш. Бошқа API протоколидаги ҳар қандай модель учун 100% автоматик мослик ваъда қилинмайди — баъзан адаптер керак.
7. Иккала AI ишламаса бот тўхтамайди: маълумотли FAQ ёки операторга ticket. Скриншотлар AI’га эмас, операторга.
8. Фойдаланувчининг шахсий аккаунт, тўлов ва хабар маълумотлари KB’га ёзилмайди. R2 private, API калитлари фақат Secret.

## 2. Архитектура ва ягона созлаш нуқтаси

Telegram → Cloudflare Worker → FAQ/intent → D1 index → R2 дан мос 1–3 English ҳужжат → AI Gateway route → Telegram қисқа жавоб.

**AI Gateway Dashboard** — асосий модель, захира модель, провайдер, route ва gateway-level лимитни ўзгартирадиган ягона иш жойи. Махфий калитлар Gateway BYOK/Secrets Store ёки мувофиқ бўлса Unified Billing орқали бошқарилади. Worker фақат битта нормализацияланган generateAnswer() интерфейсини чақиради.

**Мажбурий техник текширув:** Cloudflare Workers AI Gateway орқали чақирилганда бепул квота қандай ҳисобланади? Квота тугаганда қандай сигнал қайтарилади? Gateway Dynamic Route ташқи моделга ҳақиқатан fallback қиладими? Қандай ҳолатда билмасдан пуллик billing ишга тушиши мумкин? Агар бу шартларни ишончли таъминлаб бўлмаса, Cloudflare native Workers AI primary ва Gateway backup’ни бирлаштирувчи жуда кичик Worker router қилинади, лекин модел номлари ягона конфигурациядан келади.

## 3. R2 Knowledge Base — ягона English манба

Private bucket ва бўлимлар мисоли:

- kb/payments/card-declined/v1.json
- kb/payments/subscription-not-active/v2.json
- kb/accounts/telegram-login/v1.json
- kb/android/update-required/v1.json
- kb/pwa/ios-install/v2.json
- kb/telegram/mini-app/v1.json
- kb/general/product-overview/v1.json

**Ҳар ҳужжатда минимал майдонлар:** id, title, body, tags, source, updated_at, version, status. Алоҳида lang йўқ.

- **source:** фактнинг тасдиқланган манбаси — official policy, production release ёки текширилган repo commit/URL.
- **updated_at:** ҳужжат қачон текширилган/янгиланган. Бу фактнинг ҳозир ҳам тўғрилигини автоматик кафолатламайди.
- **version:** ҳар ўзгариш алоҳида R2 объект. Эски версия rollback учун сақланади.
- **status:** draft, approved ёки deprecated. AI фақат approved ҳужжатни кўради.
- **D1 knowledge_index:** id, title, tags, source_ref, active_object_key, version, approved_at, updated_at, checksum.
- **R2:** файллар; **D1:** active pointer ва қидирув. Бир катта файлни ўқиш йўқ.

Янгилаш кетма-кетлиги: манба текшириш → янги English файлни draft қилиш → schema/fact validation → owner approval → R2 янги revision → D1 active pointer алмаштириш → rollback имконияти.

Автоматик GitHub commit/релиз кузатуви фактни мустақил тасдиқламайди. Production версияда кўринмаган ўзгаришни AI user-visible деб айтмаслиги керак.

## 4. Қидирув — энг енгил MVP

- Аниқ FAQ/меню жавобларига AI ёки R2 чақирилмайди.
- User матнидан keyword/tag билан соҳани топиш; D1 индексдан 1–3 мос approved файл танлаш.
- Worker фақат шу R2 файлларни ўқийди; AI’га user саволи, танланган English фактлар ва чиқиш тили берилади.
- Мос ҳужжат йўқ, эски ёки зид фактлар бор — AI тахмин қилмайди, операторга ўтади.
- Бошланғич версияда Vectorize, embedding, AI Search, алоҳида RAG сервери йўқ. D1 full-text/FTS5 имкони алоҳида синовдан кейин керак бўлса қўшилади.

## 5. AI fallback, нарх ва хавфсизлик

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

**Phase 2 — R2 + D1 KB:** private bucket, index migration, 5–10 та owner-approved English ҳужжат, кичик retrieval, version/rollback, аниқ user жавоблари.

**Phase 3 — update workflow:** GitHub/product ўзгаришларини detection → draft → approval → publish. Хато бўлса аввалги approved фактлар қолади.

**Phase 4 — rollout:** CI, staging, реал RU/TJ/UZ саволлари, quota/timeout/invalid token/cost tests, операторга тўғри ўтиш, мониторинг. Production deployment фақат owner тасдиғи ва rollback варианти билан.

## 7. Acceptance criteria

- HSK AI Railway серверига Support’дан 0 сўров.
- Модел ва backup алмашиш Telegram кодини таҳрирламасдан мумкин.
- FAQ AI/R2сиз; KB сўрови максимум 1–3 R2 ҳужжат.
- KB бир тилда, фақат approved ва source-backed. Таржима дубликатлари йўқ.
- Free AI quota exhaustion ҳолатида захира ишлайди; у ҳам ишламаса Telegram операторга ticket келади.
- Ботнинг мавжуд Reply, /close, фото, deep-link, typing ва webhook имкониятлари бузилмайди.
- Лимит, харажат, AI хатолари ва rollback амалда текширилган.

## 8. Муҳокама учун ОЧИҚ қарорлар

| ID | Савол | Таклиф (тасдиқланмаган) |
|---|---|---|
| Q1 | Ҳақиқий фактнинг source of truth’и: production, GitHub main, расмий сайт, owner policy — қайси бири устун? | Тасдиқланган production user-visible ҳолат + owner-approved policy. Commit фақат далил. |
| Q2 | Билим ҳужжатини ким approved қила олади? | Фақат owner; оператор фақат draft таклиф қилади. |
| Q3 | GitHub/сайт/релиз янгиликларини қандай кузатамиз: webhook, ҳар 6 соат, кунлик? | Automatic detection + manual approval. |
| Q4 | Биринчи KB қайси бўлимдан: тўлов, обуна, аккаунт, Android, PWA, Telegram? | Тўлов + аккаунт + Android/PWA, кейин қолганлари. |
| Q5 | Захира провайдер ва модель қайси? | RU/TJ/UZ сифати текширилган битта арзон модель. |
| Q6 | Захира тўлови Gateway Unified Billing’ми ёки BYOK API калитими? | BYOK, агар provider hard spending limit бор бўлса; қулайликни ҳам солиштириш. |
| Q7 | Захира учун кунлик ва ойлик максимал бюджет қанча? | Бошланғич таклиф $0.20/кун ва $3/ой. |
| Q8 | AI сўров лимити: ҳозир 3/user ва 60/global — янги меъёр қанча? | 5/user/кун, глобал Neuron ва бюджет билан назорат. |
| Q9 | Охирги user хабарларидан контекст сақлаймизми? | Масалан, 30 дақиқагача 2–3 хабар, автоматик ўчириш, PIIсиз. |
| Q10 | Қайси KB маълумотлари тез эскиради ва қайта тасдиқ муддати қанча? | Payment/plan — ҳар релиз/политика алмашганда; general — камроқ. |
| Q11 | Техник AI хатосида 1+1 чақирувдан кейин нима кўрсатамиз? | Қисқа статус ва operator ticket, чексиз retry йўқ. |
| Q12 | Моделни алмаштириш интерфейси фақат Cloudflare Dashboard’ми ёки Admin PWA ҳам керакми? | MVP фақат AI Gateway Dashboard. |
| Q13 | KB revision сақлаш сиёсати? | Approved версиялар + охирги 5 revision. |
| Q14 | Оператор Telegram гуруҳидан KB ўзгаришига таклиф кирита оладими? | MVP учун йўқ; кейин мумкин. |
| Q15 | Янги AI провайдер учун мослик чегараси қандай? | Gateway/compatible API — config only; native incompatible API — adapter. |
| Q16 | RU/TJ/UZ сифати ва тўлов FAQ жавобларини ким қабул қилади? | Owner 10 та real савол × 3 тил билан тасдиқлайди. |

**Биринчи муҳокама учун устувор саволлар:** Q1, Q2, Q5, Q6, Q7, Q8, Q9, Q12. Қолганларига тавсияни қабул қилиш ёки ўзгартириш мумкин. Тасдиқдан олдин ишга туширилмайди.

## 9. Ҳозир бажарилмайдиган ишлар

Р2 bucket, AI Gateway paid route, D1 migration, конфигурация ёки Worker deployment **ҳозир қилинмайди**. Бу фақат дизайн режаси. Ҳозирги Support Bot одатдагидек ишлашда давом этади.

## 10. Cloudflare расмий маълумотлар

- AI Gateway REST API: https://developers.cloudflare.com/ai-gateway/usage/rest-api/
- AI Gateway Dynamic Routing: https://developers.cloudflare.com/ai-gateway/features/routing/dynamic-routing/
- Unified Billing / BYOK: https://developers.cloudflare.com/ai-gateway/features/unified-billing/
- R2 pricing: https://developers.cloudflare.com/r2/pricing/
- R2 Workers binding: https://developers.cloudflare.com/r2/get-started/workers-api/
- D1: https://developers.cloudflare.com/d1/
