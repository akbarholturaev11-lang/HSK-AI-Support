# HSK AI Support — standalone Telegram support bot

Production Worker: https://hsk-ai-support.hskaiiapp.workers.dev  
Health: https://hsk-ai-support.hskaiiapp.workers.dev/health  
GitHub: https://github.com/akbarholturaev11-lang/HSK-AI-Support

**Architecture:** Cloudflare Workers + Cloudflare D1 + native Workers AI + Telegram Bot API. **No requests to the main HSK AI Railway backend.**

## Current Support implementation

The current implementation is defined by `src/index.js`, `src/ai.js`, `src/content.js` and the active Cloudflare Worker. See [CURRENT_SUPPORT_FLOW.md](docs/CURRENT_SUPPORT_FLOW.md) for the button-free support conversation and checks.

Verified audit baseline on 2026-11-07: **Worker v39** (GitHub main `d94f49cf808366c5ceda5bc371b9a229b3eaba49`) was 100% active with 9 inherited bindings and the image Queue consumer. Telegram command cleanup succeeded in D1 (`support_commands_hidden_v1=1`, 2026-11-07 14:00:43 UTC). This is a past audit checkpoint, not a claim that v39 will always remain the latest deployment.

## Screenshot report follow-up memory

Support records a **sanitized text summary and the successful Support reply** for image reports and image answers, just like ordinary text turns. It never persists the screenshot bytes or Telegram media IDs in `ai_conversation`. Short follow-ups such as "still not working" can use the prior error's context. The existing one-hour / 12-message history TTL and `/start` / typed-FAQ reset behavior stay unchanged.

## Plain Support conversation (without buttons)

`/start` displays only a brief RU/TJ/UZ greeting; it never sends an inline keyboard. The four old category buttons are removed from new messages. Typed `/operator` and `/help` continue to work, and historical category callbacks are handled for compatibility. Telegram command lists are cleared once for the default and all-private scopes, including RU/TJ/UZ language variants; the bot-wide menu button is reset to the default. Telegram clients may still render the built-in Menu control because its appearance is not controlled by bot message markup. The five-minute cron retries a failed command-list cleanup safely without stopping support.

## 60-second screenshot explanation window

An uncaptioned Telegram screenshot is held for up to 60 seconds before Vision analysis. If the user sends an explanation within that period, the Support bot sends the **original Telegram image plus the new text together** in one AI request. Already-captioned images continue to be analyzed immediately. A delayed Queue worker analyzes the image alone only when no text arrives; users do not see an early standalone AI answer.

Implementation: additive short-lived D1 table `pending_images`, Cloudflare Queue `hsk-ai-support-image-delay` and Worker binding `IMAGE_DELAY_QUEUE`. Only a Telegram file reference and routing metadata are stored, never screenshot bytes, raw captions or OCR. See `docs/IMAGE_GRACE_60S_AUDIT_2026-11-07.md` and `migrations/002_pending_images.sql`. Queue availability and its consumer are separate release dependencies; GitHub merge alone does not activate the feature.

Telegram Bot API does not publish whether the user is currently typing to the bot, so the fixed 60s grace is the only supported hold. A delayed Queue may run after 60 seconds rather than at an exact wall-clock deadline.

## Knowledge Base (R2)

- Private R2 Standard bucket: `hsk-ai-support-kb` (Eastern Europe).
- Historical early-V2 release `e6ee6a686f48df961a5c28516e9db26373abb077` → Worker `2dc617fd-c863-4a1e-b873-b58af92b42d3` is **superseded**. Current Support still reads R2 English product knowledge through the `KB` binding. Real Telegram client E2E remains a separate verification step.
- First English-only, topic-specific files in R2: `knowledge/payments.json`, `subscriptions.json`, `accounts.json`, `android.json`, `pwa.json`, `telegram.json` and `general.json`.
- `knowledge/sync_state.json` stores the last checked `HSK-AI-Bot/main` commit SHA. It was bootstrapped to `c8c1aaf5b2b07b40878017ae8f6bb7a60da4b073` after verifying all seven R2 objects.
- The active ChatGPT task **HSK AI KB Sync** is scheduled every four hours, checks changes in `HSK-AI-Bot/main`, and is configured to update changed English R2 topics. A synthetic Cloudflare R2 backup/replace/rollback test passed; a completed autonomous scheduled cycle under the updated rules has **not** been independently confirmed.
- No GitHub Actions upload workflow and no separate S3 credentials are required for this connector-based path. The currently configured GitHub Actions workflow runs code tests only.

## V2 implementation deployed to production (2026-11-07)

**Historical V2 deployment checkpoint (superseded):** GitHub `e6ee6a686f48df961a5c28516e9db26373abb077` → Worker `2dc617fd-c863-4a1e-b873-b58af92b42d3`. Current Support is a plain AI chat in RU/TJ/UZ without category buttons. R2-grounded answers, original-image bug reporting, 60-second screenshot grace and short-term conversation memory are preserved. The backup MiniMax provider is a separately gated feature.

- `src/knowledge.js`: keyword routing to at most two validated R2 English topic records. When an R2 record is missing or malformed, do not invent facts; use the existing no-knowledge or verified handoff path. Uncertain questions do not automatically generate an operator ticket.
- `src/ai.js`: R2-grounded short answers, language adaptation, native Gemma 4, and optional MiniMax M3.1 Flash backup on technical primary failure. Backup is **OFF by default**. It needs explicit `BACKUP_ENABLED`, `BACKUP_BILLING_APPROVED`, `BACKUP_SPEND_CAP_VERIFIED` and `AI_GATEWAY_ID` settings. It calls the supported `minimax/m3.1-flash` catalog model through Cloudflare Gateway; the earlier `support-backup` dynamic route was invalid and is not used. A model handoff/uncertain answer never triggers paid retries.
- `src/index.js`: accepts Telegram photo / JPEG-PNG image documents, checks safety of captions, distinguishes download errors from model refusal and recognizes interface/design/UX feedback. Sanitized image descriptions and replies (never raw bytes or media IDs) can be stored in short-lived conversation history. A fully live Telegram photo-to-Vision smoke test is still pending.
- `src/conversation.js` and `schema.sql`: last five redacted dialog messages from the preceding hour; cron prunes older context at five-minute intervals. D1 additive table/index migration is applied and verified using a synthetic test exchange. V2 Worker **is now deployed** and can use the migrated `ai_conversation` table; live context retention behavior still needs E2E verification.
- Support AI and private user messages have **no product-enforced daily per-user or shared AI request caps**. AI-classified operator reports also have no artificial 3/day quota; every verified report delivery is checked against Telegram success. Webhook update-id deduplication, classification and Telegram rate limits still apply. Provider availability is not guaranteed.
- Backup cost controls: Cloudflare Gateway `hsk-ai-support` has enabled model-specific cost rules of $0.20/day and $3/30 days; 20 requests/day and 300/month are additional D1 request caps, **not USD hard caps**. Cloudflare spend enforcement is eventually consistent. Unified Billing credits currently $0, auto-topup OFF. Fund credits manually only with owner-approved amount; do not claim MiniMax is live until a paid test and V2 deployment succeed.
- **Historical 2026-11-06 QA baseline:** 64 tests and 30 model trials were recorded then; do not present those counts as current release results. Use the newest GitHub Actions run to verify CI and `docs/V2_QA_2026-11-06.md` only for its historical findings.
- Scheduled `HSK AI KB Sync` instructions use backup-before-replace and `main`-first KB. Synthetic R2 backup/replace/rollback in temporary QA objects passed. An independently completed scheduled agent cycle remains unverified.
- Security: Cloudflare `BOT_TOKEN` has been verified as `secret_text`, and the user confirmed that `/start` receives a reply.

**Release sequence:** D1 schema applied, token secured, and synthetic R2 rollback tested. V2 still requires independent KB agent verification, real Telegram end-to-end Vision and handoff checks, manual credit funding, and real MiniMax cost tests before paid backup activation. Production deployment was explicitly authorized and completed; paid MiniMax remains unapproved/unfunded. A GitHub merge alone does not deploy this Worker.

## Features

- RU/TJ/UZ automatic text-based language detection with persistence in D1; Telegram/deep-link locale is a fallback, not a language-selection UI.
- Concise FAQ and natural AI replies are validated by the current decision parser (with longer answers allowed when necessary). Verified short typed FAQs can be answered directly; no button selection is required.
- Native Telegram typing indicator during AI processing.
- Current Worker does not check `ai-user`, `ai-global`, `msg-user` or `ai-report` daily quotas. Distinct actionable operator reports can be forwarded repeatedly on the same ticket. Paid backup-model spend limits remain. Unexpected delivery errors are logged by stage without user data.
- When a learner submits a screenshot as evidence of a reported HSK AI malfunction or actionable UX feedback, the Support bot forwards the ORIGINAL Telegram image to its private specialist group with the report. This is an internal support handoff, without an extra per-image consent button. An explicit screenshot error is reported even if the AI also provides a workaround. Routine screenshots and unrelated questions do not automatically open reports; credentials and payment-proof captions retain existing safety routing. If Telegram cannot copy the image, the learner receives a delivery warning.
- Private operator Telegram group: reply to a ticket message to answer the user; reply /close to close it.
- V2: safe photos are passed to Vision; sensitive proofs and credential-bearing captions are not automatically escalated to the operator. Human chat uses typed `/operator` (historical operator-button callbacks are retained). AI may independently forward actionable error reports after confirmed Telegram delivery. Operator ticket metadata is compact, with one opening and one closing notification.
- D1 stores ticket and routing metadata plus short-lived **sanitized text** dialogue history. It does not store screenshot bytes or Telegram media IDs in AI chat history.
- Daily metadata cleanup and idempotent Telegram webhook setup.

## Configured in Cloudflare

- Worker: hsk-ai-support
- D1: hsk-ai-support (DB binding; SQL schema already initialized)
- AI: native Cloudflare Workers AI, Gemma 4 26B A4B model with thinking disabled
- Worker origin: https://hsk-ai-support.hskaiiapp.workers.dev
- Cron: 5-minute webhook setup checks plus daily cleanup at 03:00 UTC
- Random WEBHOOK_SECRET already generated and stored securely on Cloudflare. Do not overwrite unnecessarily.

### Setup checklist for new installations (existing Production is configured)

**1. Existing Production already stores BOT_TOKEN as a Cloudflare Secret** (`secret_text`, verified on 2026-11-07). Never regenerate or re-enter it unnecessarily. For a new installation, configure exactly one `BOT_TOKEN` Secret in Cloudflare and verify webhook connectivity; never paste the token in GitHub or chat.

The Worker will register its Telegram webhook using the secret already stored in Cloudflare. For an immediate registration or live status check, open https://hsk-ai-support.hskaiiapp.workers.dev/activate . This one-tap endpoint is rate-limited, does not expose tokens, and reports Telegram delivery errors. Cloudflare Cron also checks automatically.

**Security:** The current `BOT_TOKEN` binding is already Secret. Do not expose it in logs, chat or GitHub.

On a new installation, FAQ and AI can work without `ADMIN_CHAT_ID`, but specialist forwarding requires the group configuration. Existing Production already has the `ADMIN_CHAT_ID` Secret.

**2. For a new installation, create a private operator Telegram group**, add the HSK AI Support Bot, and send /chatid from a group administrator. The bot verifies administrator status and replies with the numeric group chat ID. If necessary use /chatid@YOUR_BOT_USERNAME.

**3. For a new installation, save ADMIN_CHAT_ID as a Cloudflare Secret**, using the numeric chat ID from step 2. It is safe to ask the project owner to configure this ID; unlike a bot token, a group ID is not an access credential.

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
