# HSK AI Support — standalone Telegram support bot

Production Worker: https://hsk-ai-support.hskaiiapp.workers.dev  
Health: https://hsk-ai-support.hskaiiapp.workers.dev/health  
GitHub: https://github.com/akbarholturaev11-lang/HSK-AI-Support

**Architecture:** Cloudflare Workers + Cloudflare D1 + native Workers AI + Telegram Bot API. **No requests to the main HSK AI Railway backend.**

## Knowledge Base (R2)

- Private R2 Standard bucket: `hsk-ai-support-kb` (Eastern Europe).
- Support Worker binding: `KB`; the Telegram/AI response flow does **not** yet retrieve KB files. Do not represent retrieval as deployed until V2 tests and code are merged.
- First English-only, topic-specific files in R2: `knowledge/payments.json`, `subscriptions.json`, `accounts.json`, `android.json`, `pwa.json`, `telegram.json` and `general.json`.
- `knowledge/sync_state.json` stores the last checked `HSK-AI-Bot/main` commit SHA. It was bootstrapped to `c8c1aaf5b2b07b40878017ae8f6bb7a60da4b073` after verifying all seven R2 objects.
- The active ChatGPT task **HSK AI KB Sync** is scheduled every four hours, checks changes in GitHub `main`, and is configured to update **only changed** English R2 topic files directly through Cloudflare. The first *future scheduled* run has not yet been independently verified.
- No GitHub Actions upload workflow and no separate S3 credentials are required for this connector-based path. The currently configured GitHub Actions workflow runs code tests only.

## V2 staging branch — not deployed

This branch implements the V2 code path; **the currently deployed Worker and main branch are unchanged**.

- `src/knowledge.js`: keyword routing to at most two validated R2 English topic records. If a production R2 record is missing or malformed, fail closed and send a human support ticket; without the binding, historical local-test fallback facts remain for compatibility.
- `src/ai.js`: R2-grounded short answers, language adaptation, native Gemma 4, and optional MiniMax M3.1 Flash backup on technical primary failure. Backup is **OFF by default** (`BACKUP_ENABLED` must explicitly be `true`). A model handoff/uncertain answer never triggers paid retries.
- `src/index.js`: photo/screenshot processing for Telegram photo or image document and existing `copyMessage` handoff. Unreadable/large/sensitive-caption images go directly to an operator. Vision payload formatting must be verified against actual provider endpoints in staging.
- `src/conversation.js` and `schema.sql`: last five redacted dialog messages from the preceding hour; cron prunes older context at five-minute intervals. New D1 table is **not deployed**. Queries fail safely if migration is not yet applied.
- 20 AI questions per user per day; static FAQ and human operator chat do not count. Existing production quota remains unchanged until deployment.
- Budget **intent**: 20 fallback calls/day and 300/month as a conservative provisional estimate, **not** a verified hard USD cap. Before enabling paid MiniMax, enforce and independently test Cloudflare Unified Billing spend controls ($0.20/day and $3/month), disable auto top-up, and review telemetry.
- GitHub CI tests include 30 RU/TJ/UZ keyword-routing examples and mocked media/provider fallback cases. Real provider image parsing and language answer quality still require staging tests; mock tests do not prove production compatibility.
- The scheduled `HSK AI KB Sync` automation prompt now says to back up the active topic before replacement and to apply `main` user-facing changes without waiting for a deployment. An independent successful scheduled run under these revised rules remains unverified.
- Security blocker: production `BOT_TOKEN` is currently stored as a Cloudflare `plain_text` binding. Migrate it to `secret_text` without exposing the value and verify webhook health **before V2 production release**.

**Release sequence:** independently test the agent and R2 backup; apply D1 schema migration; verify vision format, quota, fallback and 30 multilingual real responses; fix any failure; only then seek authorization for paid billing and production deployment. A GitHub merge alone does not deploy this Worker.

## Features

- RU/TJ/UZ language and source detection from Telegram deep links; Telegram-language fallback.
- Short FAQ and natural AI answers: 1–2 sentences, maximum 220 characters.
- Native Telegram typing indicator during AI processing.
- Maximum 3 AI calls/user/day and 60 AI calls globally/day, with operator fallback.
- Private operator Telegram group: reply to a ticket message to answer the user; reply /close to close it.
- Photos/media forwarded to the operator without storing media files.
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

**1. Add BOT_TOKEN secret to Cloudflare.** Open Cloudflare Dashboard → Workers & Pages → hsk-ai-support → Settings → Variables and Secrets → Add. Type **Secret**, name BOT_TOKEN, value: token from Telegram BotFather. Never paste the bot token in GitHub or chat.

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
