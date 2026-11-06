# HSK AI Support V2 — implementation & release checklist

Status: **implemented in isolated branch, NOT production-deployed**. Approval for a paid gateway, storage migration and production deployment is a separate decision.

## Implemented in this branch

- `src/knowledge.js`: deterministic RU/TJ/UZ/EN keyword routing to at most two English R2 topic files. Reject missing, malformed, or untrusted document metadata; do not generate facts without a relevant R2 file.
- `src/ai-router.js`: Workers AI Gemma 4 primary through named Cloudflare AI Gateway; MiniMax M3.1 Flash backup when the primary errors or returns malformed output. Explicit model `handoff` goes straight to the operator.
- Backup is **OFF** unless all three values are explicitly set to `true`: `MINIMAX_BACKUP_ENABLED`, `BACKUP_BILLING_APPROVED`, `GATEWAY_SPEND_LIMITS_CONFIRMED`. No paid provider key is stored in GitHub. Budget reservations conservatively allow at most 20 backup attempts in a day and 300 in a month, reserving $0.01 per attempt; these are **not precise charges** or a replacement for the Gateway spend caps.
- `src/conversation.js`: last five sanitized user/AI turns, sliding one-hour expiry. Context is stored only in D1, never in R2. Email addresses, numbers, URLs and username-like tokens are removed before storage. Do not claim heuristic redaction catches all sensitive content.
- AI quota: **20 AI answers/user/day**. Static FAQ and human-operator messages are not subject to this quota. Existing processing and operator-ticket deduplication remain in place.
- Daily cleanup removes one-hour-expired context.
- Tests: deterministic multilingual routing, invalid-R2 fail-closed behavior, budget opt-in and limits, one-hour context expiry, typing, 20 daily AI responses, 65 static FAQ messages without a quota, existing webhook/operator tests.
- `wrangler.toml` references the dedicated named gateway, but the Worker has **not** been redeployed.

## Cloudflare preparation already completed

- R2 bucket: `hsk-ai-support-kb` (private) and Worker `KB` binding.
- English R2 topic documents: payments, subscriptions, accounts, android, pwa, telegram, general.
- Named AI Gateway: `hsk-ai-support`; gateway authentication on; model request/response logging off; Workers AI billing mode `postpaid` (NOT switched to Unified Billing).
- MiniMax-specific spend-limit rules on this gateway: **$0.20 per 86,400s** and **$3 per 2,592,000s**. The latter is a 30-day window, not necessarily a calendar month. The Gateway rules are additional enforcement, not an absolute guarantee against delayed provider charges.
- No paid MiniMax inference performed, no Unified Billing credits purchased, no auto top-up enabled.
- Existing 4-hour ChatGPT `HSK AI KB Sync` instruction updated for Q10/B (main-first user-facing changes) and Q13/A (copy each changed topic to one previous-version object before rewriting). Scheduled runtime completion has not been independently verified.

## Before any production rollout

1. Review branch PR and verify all GitHub Actions `npm test` checks are green.
2. **Security blocker:** `BOT_TOKEN` currently appears as a plain-text Worker binding. Move it to a proper Worker Secret safely; rotate if it may have been exposed. Do not print it or commit it.
3. Apply the **additive-only** `support_context` table from `schema.sql` to the existing D1 database. Confirm migrations and a backout/rollback plan on staging. Missing table does not prevent responses but disables conversation memory.
4. Validate routing with R2 live reads in a safe staging environment; do not send or store real personal payment details. Validate PWA feature flag caveats and dynamic prices against `main`.
5. Verify the primary Workers AI route uses the expected free-quota / postpaid behavior. The dedicated Gateway is created, but inference through it has not been smoke-tested on real production traffic.
6. Set up **Unified Billing** only after explicit user approval for a purchase and confirmation of low-balance behavior; keep automatic top-up disabled. Test MiniMax and RU/TJ/UZ output only after that approval. Set `MINIMAX_BACKUP_ENABLED=true` and `BACKUP_BILLING_APPROVED=true` only when paid inference is authorized and spend controls checked.
7. Run actual multilingual generation acceptance tests (at least 10 Support scenarios × RU/TJ/UZ) and provider-error/timeouts. The 30 deterministic routing tests do **not** establish live model output quality.
8. Obtain separate production deployment approval, deploy, smoke-test /start, FAQ, operator Reply and /close, typing, R2 knowledge read, quota, fallback, and rollback.

## Rollback

Rollback Worker to its previous deployed version; this does not reverse D1 data. The new D1 table is additive and can remain unused on rollback. The scheduled KB agent stores one previous topic JSON in `knowledge/_previous/{topic}.json` before each update. Do not assume the previous-file mechanism has been exercised until a real agent cycle verifies it.
