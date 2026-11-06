# HSK AI Support — standalone Telegram support bot

Production Worker: https://hsk-ai-support.hskaiiapp.workers.dev  
Health: https://hsk-ai-support.hskaiiapp.workers.dev/health  
GitHub: https://github.com/akbarholturaev11-lang/HSK-AI-Support

**Architecture:** Cloudflare Workers + Cloudflare D1 + native Workers AI + Telegram Bot API. **No requests to the main HSK AI Railway backend.**

## Knowledge Base (R2)

- Private R2 Standard bucket: `hsk-ai-support-kb` (Eastern Europe).
- Production Support Worker now runs GitHub `main` commit `74d51cda61ebb99d7c0fe4c7e19c3b44b681ee97` (Worker v17 `3f9ed6d4-2782-4789-bcd3-46650d80ca01`). Private English R2 knowledge is retrieved via binding `KB`. Live Telegram end-to-end checks after the latest menu/routing fix remain open.
- First English-only, topic-specific files in R2: `knowledge/payments.json`, `subscriptions.json`, `accounts.json`, `android.json`, `pwa.json`, `telegram.json` and `general.json`.
- `knowledge/sync_state.json` stores the last checked `HSK-AI-Bot/main` commit SHA. It was bootstrapped to `c8c1aaf5b2b07b40878017ae8f6bb7a60da4b073` after verifying all seven R2 objects.
- The active ChatGPT task **HSK AI KB Sync** is scheduled every four hours, checks changes in `HSK-AI-Bot/main`, and is configured to update changed English R2 topics. A synthetic Cloudflare R2 backup/replace/rollback test passed; a completed autonomous scheduled cycle under the updated rules has **not** been independently confirmed.
- No GitHub Actions upload workflow and no separate S3 credentials are required for this connector-based path. The currently configured GitHub Actions workflow runs code tests only.

## V2 implementation deployed to production (2026-11-07)

Latest production release: GitHub `main` commit `74d51cda61ebb99d7c0fe4c7e19c3b44b681ee97` deployed at **100%** as Worker v17 `3f9ed6d4-2782-4789-bcd3-46650d80ca01` (deployment `68300e0b-e1cd-4ac9-8903-6e181ec5d878`). Previous production version `40751a9e-8e0c-4616-8b6c-1b45e5e25675` retained for rollback. All existing Secret, AI, D1, R2 and plain-text bindings inherited under strict validation. **Only `/start` sends the four-category keyboard; FAQ, category callback, `/help` and AI answers are plain text. Human operator requires explicit `/operator` or an operator-button tap; `/start` closes an active operator ticket and returns to self-service.** Opening and closing notices remain; active chat has no delivery acknowledgement. GitHub 68/68 tests passed. Live Telegram E2E of this release still requires a user smoke test. MiniMax backup stays OFF due zero credits.

- `src/knowledge.js`: keyword routing to at most two validated R2 English topic records. If a production R2 record is missing or malformed, fail closed and send a human support ticket; without the KB binding, questions fail closed to the operator; hardcoded fallback facts are not used in V2.
- `src/ai.js`: R2-grounded short answers, language adaptation, native Gemma 4, and optional MiniMax M3.1 Flash backup on technical primary failure. Backup is **OFF by default**. It needs explicit `BACKUP_ENABLED`, `BACKUP_BILLING_APPROVED`, `BACKUP_SPEND_CAP_VERIFIED` and `AI_GATEWAY_ID` settings. It calls the supported `minimax/m3.1-flash` catalog model through Cloudflare Gateway; the earlier `support-backup` dynamic route was invalid and is not used. A model handoff/uncertain answer never triggers paid retries.
- `src/index.js`: photo/screenshot processing for Telegram photo or image document and existing `copyMessage` handoff. Unreadable/large/sensitive-caption images go directly to an operator. Gemma 4's Cloudflare REST endpoint accepted a 64x64 PNG as an OpenAI-compatible `image_url` data URI (2026-11-06) and answered the visible-color question correctly; the full deployed Worker binding and MiniMax image path still require end-to-end staging tests.
- `src/conversation.js` and `schema.sql`: last five redacted dialog messages from the preceding hour; cron prunes older context at five-minute intervals. D1 additive table/index migration is applied and verified using a synthetic test exchange. V2 Worker **is now deployed** and can use the migrated `ai_conversation` table; live context retention behavior still needs E2E verification.
- 20 AI questions per user per day; static FAQ and human operator chat do not count. V2 is deployed; its intended AI quota is 20 questions/user/day (also limited by the global AI budget).
- Backup cost controls: Cloudflare Gateway `hsk-ai-support` has enabled model-specific cost rules of $0.20/day and $3/30 days; 20 requests/day and 300/month are additional D1 request caps, **not USD hard caps**. Cloudflare spend enforcement is eventually consistent. Unified Billing credits currently $0, auto-topup OFF. Fund credits manually only with owner-approved amount; do not claim MiniMax is live until a paid test and V2 deployment succeed.
- GitHub CI includes 30 RU/TJ/UZ keyword-routing examples and mocked media/provider tests; 64 Node tests passed and Wrangler bundling with `--dry-run` succeeded. Additionally, 30 real Gemma 4 requests returned valid JSON under 220 characters, but some had unsupported instructions; deterministic handoff and output protections were added. See `docs/V2_QA_2026-11-06.md` for limitations.
- Scheduled `HSK AI KB Sync` instructions use backup-before-replace and `main`-first KB. Synthetic R2 backup/replace/rollback in temporary QA objects passed. An independently completed scheduled agent cycle remains unverified.
- Security: Cloudflare `BOT_TOKEN` has been verified as `secret_text`, and the user confirmed that `/start` receives a reply.

**Release sequence:** D1 schema applied, token secured, and synthetic R2 rollback tested. V2 still requires independent KB agent verification, real Telegram end-to-end Vision and handoff checks, manual credit funding, and real MiniMax cost tests before paid backup activation. Production deployment was explicitly authorized and completed; paid MiniMax remains unapproved/unfunded. A GitHub merge alone does not deploy this Worker.

## Features

- RU/TJ/UZ language and source detection from Telegram deep links; Telegram-language fallback.
- Short FAQ and natural AI answers: 1–2 sentences, maximum 220 characters.
- Native Telegram typing indicator during AI processing.
- Current V2 Worker allows up to 20 AI questions per user daily and 600 global AI calls daily; static FAQ and human chat do not consume this AI quota.
- Private operator Telegram group: reply to a ticket message to answer the user; reply /close to close it.
- V2: photos are read by Vision when safe; otherwise copied to an operator without storing raw media. Operator tickets use one compact HTML card (`@nick`, language, `/close`, blockquoted request); users get one opening notice and one closing notice; during active conversation, follow-up user messages and operator replies are copied directly with **no additional delivery acknowledgements**.
- D1 stores only Telegram IDs, source, language, ticket status, and reply mappings; no message bodies.
- Daily metadata cleanup and idempotent Telegram webhook setup.

## Configured in Cloudflare

- Worker: hsk-ai-support
- D1: hsk-ai-support (DB binding; SQL schema already initialized)
- AI: native Cloudflare Workers AI, Gemma 4 26B A4B model with thinking disabled
- Worker origin: https://hsk-ai-support.hskaiiapp.workers.dev
- Cron: 5-minute webhook setup checks plus daily cleanup at 03:00 UTC
- Random WEBHOOK_SECRET already generated and stored securely on Cloudflare. Do not overwrite unnecessarily.

### What the bot owner still needs to do

**1. Secure the existing BOT_TOKEN Cloudflare binding.** Open Cloudflare Dashboard → Workers & Pages → hsk-ai-support → Settings → Variables and Secrets. Find the existing BOT_TOKEN (currently Plain Text), securely replace/re-enter it as type Secret with the **same actual BotFather token**, then save and verify webhook. Do **not** create two BOT_TOKEN bindings or paste the token in GitHub or chat.

The Worker will register its Telegram webhook using the secret already stored in Cloudflare. For an immediate registration or live status check, open https://hsk-ai-support.hskaiiapp.workers.dev/activate . This one-tap endpoint is rate-limited, does not expose tokens, and reports Telegram delivery errors. Cloudflare Cron also checks automatically.

**Security:** In Cloudflare Variables and Secrets, BOT_TOKEN must be type **Secret** (not Plain Text). Re-enter it securely if the variable was originally saved as Plain Text. Do not post the token in chat or GitHub.

The FAQ and AI work even before ADMIN_CHAT_ID is added. Operator escalation becomes available after the private group ID is configured.

**2. Create a private operator Telegram group**, add the HSK AI Support Bot, and send /chatid from a group administrator. The bot verifies administrator status and replies with the numeric group chat ID. If necessary use /chatid@YOUR_BOT_USERNAME.

**3. Save ADMIN_CHAT_ID as a Cloudflare Secret**, using the numeric chat ID from step 2. It is safe to ask the project owner to configure this ID; unlike a bot token, a group ID is not an access credential.

**4. Test:** /start in the private support chat, send an unknown payment question, reply to its ticket from the operator group, then reply /close. Also test RU/TJ/UZ deep links and screenshots.

Support requests can be accepted around the clock, but an actual human operator is not guaranteed to reply 24/7.

## Deep-link examples

Substitute the actual BotFather username if different:

- RU Android: https://t.me/hskai_support_bot?start=ru_android
- TJ PWA: https://t.me/hskai_support_bot?start=tj_pwa
- UZ Telegram: https://t.me/hskai_support_bot?start=uz_bot
- RU Instagram: https://t.me/hskai_support_bot?start=ru_ig
- TJ Instagram: https://t.me/hskai_support_bot?start=tj_ig
- RU website: https://t.me/hskai_support_bot?start=ru_web

Deep links select source and language, but **do not authenticate a user account**.

## Source, tests and deployment

- Node.js 22+, npm test for unit tests.
- GitHub Actions runs unit tests on each push.
- wrangler.toml already points to the provisioned D1 database.
- Production was deployed with Cloudflare API; **GitHub auto-deployment is NOT configured**. GitHub pushes do not automatically update the production Worker.
- To redeploy from a trusted authenticated environment use npm run deploy. Verify that production secrets remain in Cloudflare.
- Do not request or store passwords, card numbers, CVV, login tokens or SMS codes.
- Workers AI usage has a Cloudflare free daily quota, and requests beyond it fail safely to the operator.
