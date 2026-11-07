# HSK AI Support — Production-Safe Stress Test (2026-11-07)

## Scope and method
- Tested Cloudflare Worker configuration and read-only D1 aggregate queries; did not send synthetic messages to real Telegram users or leak secrets.
- Inspected all seven R2 knowledge topics: accounts, android, general, payments, pwa, subscriptions, telegram (24 validated facts per topic, 168 total).
- Tested the actual `@cf/google/gemma-4-26b-a4b-it` Cloudflare inference endpoint with **46 synthetic inferences** in Russian, Uzbek and Tajik, including repeated/A-B trials.
- Model tests used real R2 facts and substantially equivalent Support instructions; they were **not full production Telegram webhook E2E**. Some trials provided all facts, some a first-pass subset, so results are diagnostic rather than an account-level availability certification.
- Checked CI with the current branch changes.

## Verified
- Cloudflare production Worker v31 was 100% active when checked; eight bindings and both scheduled triggers were present.
- Production D1 contained the expected six core tables. Read-only aggregate check returned 138 processed webhook updates within the most recent 24h and tickets with 8 closed / 2 open. This shows activity, **not** answer quality or webhook delivery confirmation for any given user.
- The R2 files had 24 facts each, source-commit strings and an internal limit of 450 characters per fact.
- Source-grounded subscription prices, Free/Trial quotas, PWA/account entitlement synchronization, unsupported Apple production sign-in, Telegram news vs learning bot and HSK 3.0 N4 limits were usually answered correctly.

## Confirmed weaknesses / regressions to monitor
1. **Format instability.** Gemma returned fenced JSON, no-action JSON, ordinary prose, overlong prose and malformed `{"handoff":"..."}` on different runs. The old parser rejects some of these and returns an unavailable fallback.
2. **Incomplete multi-step guidance.** Play-installed Android has no Pro checkout; even with verified PWA facts available, some Russian, Tajik and short Uzbek follow-up answers stopped after saying the Play version has no buy button, without explaining a supported external browser option. In another run it did answer correctly. This is model/retrieval quality variability, **not** missing R2 documentation.
3. **Language drift.** Some Uzbek Cyrillic questions were answered in Uzbek Latin; at least one Tajik question received Uzbek text. Language accuracy needs targeted regression testing; JSON output alone does not fix it.
4. **Misclassification.** A user unable to locate Play's intentionally absent purchase button was occasionally classified by the model as product feedback, although the verified facts describe the missing button as expected.
5. **Overclaims.** For a fictional Nintendo Switch Bluetooth integration the model sometimes asserted absolute non-support rather than saying verified product docs do not establish availability. Product absence requires explicit evidence.
6. **Report wording.** A bug report draft occasionally claimed it would forward the issue, although the application sends a separate delivery-confirmed notification. The implementation suppresses the AI draft if forwarding fails, but duplicate messaging is possible if forwarding succeeds.
7. **No live Telegram client E2E.** Mocked ticket/image tests and direct model trials do not verify Telegram user delivery, operator screenshot receipt, client rendering or runtime latency.

## Corrective branch changes
- Request `response_format: {type:"json_object"}` from the primary model via both Worker AI binding and compatible external endpoint, and lower sampling temperature to 0.2.
- Recover safe legacy `{"handoff":"..." }` model envelopes as handoff only when there is no other conflicting field. Mixed handoff/answer JSON is rejected.
- Add **one generic reasoning rule** that directs the AI to find verified ways to accomplish the user's goal and not infer feature absence without evidence. **No scripted user replies, prices, payment links or canned platform answers were added to the prompt.**
- Extend unit and integration tests to verify new model-call options and fallback safety.

## Acceptance and follow-up
- Current branch CI: **114 tests passed, zero failed**.
- Must still run manual E2E in the real Telegram Support bot with a designated test account: Google Play missing Pro flow (RU/TJ/UZ), PWA purchase entitlement, privacy-safe screenshot forwarding and operator reply mapping, unavailable payment status, and topic-change context retention.
- Do not claim all errors solved or that a real user purchase was successful from synthetic inference.
