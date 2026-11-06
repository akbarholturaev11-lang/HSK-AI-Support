# HSK AI Support — standalone Telegram support bot

Production Worker: https://hsk-ai-support.hskaiiapp.workers.dev  
Health: https://hsk-ai-support.hskaiiapp.workers.dev/health  
GitHub: https://github.com/akbarholturaev11-lang/HSK-AI-Support

**Architecture:** Cloudflare Workers + Cloudflare D1 + native Workers AI + Telegram Bot API. **No requests to the main HSK AI Railway backend.**

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
