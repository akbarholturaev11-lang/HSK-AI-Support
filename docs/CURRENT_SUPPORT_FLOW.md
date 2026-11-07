# HSK AI Support — current plain-chat workflow

Last implementation audit: 2026-11-07. This document describes the intended source-code behavior at main after the button-free start change. **A GitHub merge is not proof of a Cloudflare deployment; check the active Worker version separately.**

## End-user contract

- `/start` starts or resets a **plain chat**. Send one short RU/TJ/UZ welcome; **no category inline keyboard** and no language-selection screen. Previous manual operator mode ends; short-term AI dialogue resets. Deep-link language/source parameters still work.
- Users directly ask about payment, subscriptions, account, Android Play/Direct, PWA, Telegram, desktop or general product support; they can attach screenshots. Do not require them to pick Payment / Account / Error / Operator first.
- Free-text short FAQ matches still yield a verified localized answer and store the *typed topic* for a follow-up. They are not a UI menu. When the question needs product facts, AI chooses and progressively reads relevant R2 knowledge topics; absence of evidence is not permission to invent facts.
- AI uses the user's current free-text question, recent dialogue, screenshot explanation and verified knowledge. It must not describe nonexistent menu navigation, demand a category choice, or treat `/start` as showing a topic keyboard. Older FAQ-button selections in history may still be read as contextual evidence, but are not a required onboarding step.
- Historical inline `help:payment`, `help:account`, `help:bug` and `help:operator` callbacks **remain supported for messages that already exist**. No new messages expose those buttons.
- Typed `/operator` remains a manual human-chat path. AI may also deliver a concrete bug/feedback report to the private specialists without switching the entire conversation to operator mode. Successful Telegram delivery is verified before claiming the report was sent.
- A bare screenshot gets a 60-second grace period using D1 `pending_images` and Cloudflare Queue; if text follows in time, Vision receives original photo + explanation together. Captioned images are handled immediately. A reported product failure can forward the original screenshot to the private specialist chat. No second consent button is requested.
- D1 conversation memory contains only sanitized text summaries and replies, not screenshot bytes, raw credential fields or Telegram photo IDs. A short continuation such as "Ҳолиям тузалмади" can use the previous report; it cannot imply the issue is fixed.

## Telegram native menu

`src/index.js` includes an idempotent five-minute-cron cleanup task `removeLegacyBotMenusOnce`. It clears default and all-private-chat command lists for default, Russian, Tajik and Uzbek locales using `deleteMyCommands`, then sets the bot-wide menu button to Telegram's default and writes `service_settings.support_commands_hidden_v1=1` only on successful completion. **Cloudflare D1 confirmed this flag was set at 2026-11-07 14:00:43 UTC.** A native Telegram Menu icon may still appear in some clients; old inline keyboards in existing messages are also not automatically deleted.

## Separation from main HSK AI

The Chinese-learning Telegram bot, Telegram Mini App, Android, PWA and Desktop have their own product navigation, course/Pro buttons and Help/Support entry points. This change removes **only the four categories inside the separate HSK AI Support bot**. Do not remove product navigation from HSK-AI-Bot. The R2 `knowledge/telegram.json` facts describing the teaching bot's menus are about that **different bot** and must not be overwritten to remove its legitimate buttons.

## Runtime and audit

- Cloudflare Worker: `hsk-ai-support`. Runtime bindings: `BOT_TOKEN`, `WEBHOOK_SECRET`, `ADMIN_CHAT_ID`, `DB`, `KB`, `AI`, `AI_MODEL`, `IMAGE_DELAY_QUEUE`, `PUBLIC_WORKER_ORIGIN`. Maintain secrets as secrets.
- Scheduled triggers: every five minutes and daily cleanup; image-delay Queue consumer stays registered.
- Last verified baseline before this documentation change: Worker v39 at 100%, source commit `d94f49cf808366c5ceda5bc371b9a229b3eaba49`. Check Cloudflare for later versions; do not use old versions in historical V2 documents to infer active deployment.
- Relevant tests: button-free /start in three locales; free-text short FAQ context; old callback compatibility; switching from human chat back to AI; deletion of command lists once; screenshot+text join; AI knowledge and bug-report forwarding.
- Real Telegram-client rendering of the native Menu control, legacy message keyboards and actual group deliveries needs a live check, in addition to mocked tests.

## Older documents

`ARCHITECTURE_V2_PLAN.md`, `V2_RELEASE_GATE.md`, `V2_QA_2026-11-06.md` and early stress-test reports are historical snapshots. Their original button, quota, provider and deployment statements must not override this document, the live source or verified Cloudflare settings.
