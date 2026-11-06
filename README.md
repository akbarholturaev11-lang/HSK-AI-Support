# HSK AI Support — Cloudflare Worker

Independent Telegram product-support bot for HSK AI. **Zero requests to the main HSK AI backend**. Stack: Cloudflare Worker, D1, Telegram Bot API, optional OpenAI-compatible HTTPS AI provider.

## MVP functionality
- Auto-language and entry-source detection: RU/TJ/UZ; android, pwa, bot, miniapp, web, ig, desktop.
- FAQ buttons; bounded AI answers using only confirmed generic facts.
- Human operator via a private Telegram group. Reply to a ticket message to send text/media back; reply /close to resolve the ticket.
- Screenshots go directly to the operator, not to a media storage or image AI.
- 60 user messages/day, 3 AI requests/user/day, 60 global AI requests/day; webhook secret validation and replay deduplication.
- Only limited metadata is stored, not messages or media. Daily metadata cleanup.

The support channel is always available, but operators are not guaranteed 24/7. AI is optional and may incur provider charges. The bot cannot verify payments, subscription ownership or HSK AI accounts.

## Deploy

Requires Node.js 20+, a Cloudflare account, a Telegram bot and a **private** operator group.

1. Install and authenticate Cloudflare:

~~~bash
npm install
npx wrangler login
npx wrangler d1 create hsk-ai-support
~~~

2. Replace REPLACE_WITH_YOUR_D1_DATABASE_ID in wrangler.toml with the created database ID. Then run:

~~~bash
npm run db:init
~~~

3. Create secrets in the Cloudflare Worker (never commit them to GitHub):

~~~bash
npx wrangler secret put BOT_TOKEN
npx wrangler secret put WEBHOOK_SECRET
npx wrangler secret put ADMIN_CHAT_ID
~~~

The WEBHOOK_SECRET must contain only ASCII letters, digits, dashes or underscores, be 1–256 chars and differ from the Telegram bot token. ADMIN_CHAT_ID is the numeric chat ID of a private Telegram operator group in which the bot has been added.

4. For AI support, optionally add AI_API_KEY with the command below. AI_BASE_URL and AI_MODEL can be changed in wrangler.toml to a compatible HTTPS chat-completions provider. The default model is **paid**, not free.

~~~bash
npx wrangler secret put AI_API_KEY
~~~

5. Run tests and deploy:

~~~bash
npm test
npm run deploy
~~~

6. Set BOT_TOKEN, WEBHOOK_SECRET and WORKER_URL in your **own trusted terminal**, with WORKER_URL pointing to the deployed Worker origin without a trailing slash. Register webhook:

~~~bash
curl -fsS -X POST "https://api.telegram.org/bot$BOT_TOKEN/setWebhook" \
  --data-urlencode "url=$WORKER_URL/webhook" \
  --data-urlencode "secret_token=$WEBHOOK_SECRET" \
  --data-urlencode "max_connections=1" \
  --data-urlencode 'allowed_updates=["message","callback_query"]'
~~~

Check Telegram getWebhookInfo and send /start to the bot. Deploying the Worker does not itself register a Telegram webhook.

## Localized entry points

Adapt the username if BotFather assigned a different one:

- https://t.me/hskai_support_bot?start=ru_android
- https://t.me/hskai_support_bot?start=tj_pwa
- https://t.me/hskai_support_bot?start=uz_bot
- https://t.me/hskai_support_bot?start=ru_ig
- https://t.me/hskai_support_bot?start=tj_ig
- https://t.me/hskai_support_bot?start=ru_web

A deep link gives language/source, **not account authorization**. Telegram must receive the user's Start action.

## Operator rules

Use only a private Telegram group with trusted staff. Reply to any copied ticket message to answer its user; reply /close to mark the ticket resolved. Avoid asking for passwords, credit card numbers, CVV, login tokens and SMS codes.

Database retention: webhook IDs 7 days, rate counters 3 days, ticket metadata 90 days. No user message bodies or uploaded files stored in D1.

Run npm test locally. GitHub Actions also runs tests on pushes and PRs.
