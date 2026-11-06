# HSK AI Support KB — Lava.top & subscriptions audit (2026-11-07)

## Verified controlling source

GitHub `akbarholturaev11-lang/HSK-AI-Bot/main`, commit `c8c1aaf5b2b07b40878017ae8f6bb7a60da4b073`. Reviewed:
- `app/services/subscription_price_service.py` — manual plans `10_days, 1_month, 3_months`, pricing from DB with fallbacks, Visa/Alipay/WeChat.
- `app/services/lava/terms.py` and `app/services/subscription_service.py` — recurring lava terms `1_month, 3_months, 6_months, 12_months` and durations 30/90/180/365 days.
- `app/services/lava/config.py` / `checkout.py` — manual_only/lava_only/both; plan visibility is configured; not proof of current production enablement; payment verified through server-created invoice.
- `app/services/lava/ledger.py` and `docs/payments/LAVA_TOP.md` — recurring renewals, cancellation preserving paid term, refund/chargeback rules, discounts and client eligibility.
- `app/api/lava_checkout.py` and `android/README.md` — supported Mini App/PWA checkout and unsupported Android Play/direct/desktop lava paths.
- `app/admin_api/pwa_lava.py` — admin-configured terms/currency; do not infer live price or enabled plan from source code.

## R2 corrected

R2 bucket `hsk-ai-support-kb`:
- `knowledge/payments.json`: 3 → 9 English facts.
- `knowledge/subscriptions.json`: 3 → 11 facts, including distinction between manual and lava recurring plans.
- `knowledge/accounts.json`: 3 → 5 facts.
- `knowledge/android.json`: 3 → 5 facts.
- `knowledge/pwa.json`: 3 → 6 facts.
- `knowledge/telegram.json`: 3 → 6 facts.
- `knowledge/general.json`: 3 → 5 facts.

**Total: 21 → 47 facts.** Each prior full topic object was written to `knowledge/backup/{topic}.json` BEFORE replacing the active object, and each new active object was read back and validated. Source SHA unchanged, metadata includes new source file references. The standard `knowledge/sync_state.json` checkpoint was deliberately **not changed**: manual correction does not mean a new HSK-AI-Bot main commit.

The enabled `HSK AI KB Sync` 4-hour agent prompt was updated to audit Lava.top terms, pricing, client eligibility, cancellation and discounts on subsequent main changes; it must preserve validated FAQ content and avoid sparse regressions.

## Integrity limitations / release caveats

1. **Current production Lava availability and actual price were not queried.** `main` proves implementation, not which terms the administrator enabled; do not promise every user can buy Lava Pro.
2. `docs/payments/LAVA_TOP.md` contains a dated November 6 provider offer price snapshot and earlier branch-status wording. Neither is proof of current effective checkout pricing/status; users should check the active checkout.
3. All seven topic files are intentionally English. The Support Worker uses its own RU/TJ/UZ prompts and topic routing.
4. This is a R2 content update and agent-rule change, **not** an HSK-AI-Bot payment configuration change, Support Worker deployment, live-price fetch or billing action.

## QA result

All 7 active topic JSON objects returned valid `topic`, non-empty `facts:string[]`, `source_commit`, `source_files` and `updated_at`; each of 7 backup objects has the previous three-fact version; total 47 facts, no malformed/overlong fact or topic mismatch. **Content grounded in code, runtime availability unverified.**
