# HSK AI Support V2 — Production release gate (2026-11-07)

This is an **operational checklist**, not authorization to deploy or enable a paid provider.

## Completed

- [x] V2 code [PR #2](https://github.com/akbarholturaev11-lang/HSK-AI-Support/pull/2) merged into `main`: `f3a930a2ada4a2d4634a02986ec206239bc78418`.
- [x] GitHub main CI tests passed (64/64); Wrangler dry-run bundle succeeded. Real Gemma 4 direct REST sample for a 64×64 image succeeded.
- [x] 30 real RU/TJ/UZ support requests validated JSON shape and max 220 chars; wrong-language and account/payment hallucination failures were detected and guarded in code.
- [x] D1 table `ai_conversation` and index `idx_ai_conversation_user_time` created; isolated synthetic write/read/delete test passed; no production user data altered.
- [x] R2 backup workflow **infrastructure** validated using synthetic objects only; original JSON, one backup, overwrite, rollback, verified restore and removal of test objects. No existing KB topic overwritten.
- [x] Cloudflare Gateway `hsk-ai-support` exists; no paid dynamic route deployed; billing flags absent/off.
- [x] Production Worker unchanged by GitHub merge. Latest checked deployment: 2026-11-06 13:04:32 UTC, version `4dc75039-c817-4dd0-8c97-b10e073ff346` (100% at time inspected).

## Mandatory release blockers

- [x] **BOT_TOKEN secret.** Verified via Cloudflare live Worker settings on 2026-11-06: `BOT_TOKEN` is now `secret_text` (previously `plain_text`), and required `DB`, `KB`, `AI`, `WEBHOOK_SECRET`, and `ADMIN_CHAT_ID` bindings remain present. Secret value was not retrieved or disclosed. A Cloudflare deployment dated 2026-11-06 17:04:03 UTC is active at 100%; this confirms a deployed Worker version, **not** that GitHub V2 source was deployed. **Still to check:** Telegram webhook `/activate` and a real test message; these are included in the end-to-end gate below.
- [ ] **Real Telegram end-to-end staging:** User confirmed that `/start` receives a reply after `BOT_TOKEN` secret migration (**basic webhook smoke: PASS**). Cloudflare active Worker source inspected: does **not** contain `lookupKnowledge`, `generateSupportAnswer`, `telegramImage` or multimodal `image_url`, proving **V2 features are not deployed**. Remaining: test current operator ticket without disturbing users, then safely stage V2 end-to-end with image, language, quotas, context and fallback.  test private /start, payment/account and unknown messages, operator ticket duplicate suppression, Telegram photo/document, image Vision screenshot analysis and failover with an operator in the loop; RU/TJ/UZ answers; D1 1-hour context expiration. Prefer isolated bot/test deployment. Do NOT change the current bot webhook to a new URL without a rollback.
- [ ] **Scheduled sync check:** wait for (or observe) an independently recorded agent run when `HSK-AI-Bot/main` changes; verify one previous version per changed R2 topic, no unverified claims, no checkpoint advance on write failure, and no modification for identical SHA. Synthetic R2 backup passed, but the scheduled workflow itself has not been observed performing a real changed-topic backup.
- [ ] **Paid MiniMax — route drafted, NOT enabled:** Cloudflare Gateway `hsk-ai-support` now contains `support-backup` dynamic route (ID `a8ede424-806e-46c5-8e8d-b76b8d70f799`), configured as MiniMax `minimax/m3.1-flash` with two cost rate nodes ($0.20 / 86400 sec and $3 / 2592000 sec), zero retries. **Cloudflare route version listing reports `is_valid:false`; do not trust/use until validation fixed.** This is an additional best-effort route budget, NOT a verified true USD hard cap and 30-day window is not a calendar month. Unified Billing credits balance **$0**; dashboard `billing/spending-limit` is **disabled**; auto top-up remains off (threshold/amount 0). Main Worker is still pre-V2 and backup approval flags are unset, so **no paid backup requests were enabled, no credit purchase made.** To proceed, create two gateway-wide `Settings > Spend limits` rules (USD $0.20/day + $3/month, action BLOCK, fixed windows), confirm route validity, manually purchase credits as desired, then stage-test and deploy V2 with appropriate approval. Cloudflare docs warn spending controls are eventually consistent and credits can rarely go negative; never claim mathematical hard cost ceiling. This replaces the earlier unchecked billing route requirement.
- [ ] Owner confirms a production release after the other critical tests and token migration.

## Deploy and rollback after all gates are green

1. Record the current live deployment ID/version and D1 migration state. Confirm the GitHub main branch is the intended release revision.
2. Test with Wrangler dry-run, and review all secrets/bindings and generated bundle. Do not upload secrets to GitHub.
3. Deploy V2 through the authenticated Cloudflare account only after approval. Preserve `KB`, `DB`, `AI`, `WEBHOOK_SECRET`, `ADMIN_CHAT_ID` and `BOT_TOKEN` bindings.
4. Verify Worker `/health`, `/activate` webhook status, /start and /operator, two user languages, a test screenshot, D1 context expiration, and blocked sensitive-payment image path. Check latency and errors.
5. On incident, revert the deployed Worker version to the known-good version recorded immediately before rollout using Cloudflare deployments/rollback controls; verify webhook endpoint, operator handoff and old quotas. Do not alter R2 KB or delete D1 records as part of a code rollback.
6. Keep paid MiniMax disabled unless billing authorization and verified USD spend controls are separately complete.

**Status:** User confirmed `/start` works; actual deployed Worker verified to be pre-V2. Main code complete and CI green; V2 production Worker deployment, real Telegram E2E and paid fallback are not complete.