# Support screenshot+text 60-second grace — audit (2026-11-07)

> The *Existing code audited* section below describes the **pre-Queue implementation**. The image delay and D1 table are now deployed. /start is a plain chat without category buttons; historical FAQ callbacks remain supported. See [CURRENT_SUPPORT_FLOW.md](CURRENT_SUPPORT_FLOW.md).

## Existing code audited
- Webhook verifies Telegram secret, deduplicates update_id in D1 and processes message/callback. Telegram does not send the user's typing status as a Bot API update.
- Media is now sent immediately through telegramImage and askAi. A later text message is not joined to the photo.
- The Vision API already supports text together with one image. The original media message_id is required to copy approved screenshots to the operator.
- D1 holds users/tickets/dedup/sanitized conversation but no pending-media queue.
- Current cron triggers every five minutes and daily cannot deliver a one-minute delay. Sleeping for one minute in the HTTP webhook would be unreliable.

## Architecture approved by audit
- Queue hsk-ai-support-image-delay and producer binding IMAGE_DELAY_QUEUE. Send minimal IDs with delaySeconds 60; Queue consumer runs on the same Worker with bounded retries.
- Additive D1 pending_images table retains only Telegram file_id, original message_id, user ID, size/type, language/source, random token, created/expires timestamps and claim status. No raw media, OCR, caption, account records, token secret or password.
- Bare photo: save pending reference and return 200 without AI call. Photo with caption: preserve immediate behavior. Text within 60 seconds: atomically claim the latest photo and call the existing Vision function with both image and text, once.
- No text within 60 seconds: delayed Queue message triggers Vision with original photo. A stale or duplicated Queue event is harmless because the D1 compare-and-set and token prevent re-claims.
- Sensitive payment/account text cancels pending images and goes through existing verification safety. /start and explicit navigation cancel queued AI work. Existing operator image forwarding uses original Telegram image message_id. Normal reports, R2, payment flows and private operator tickets are unchanged.
- If scheduling the Queue message fails, remove the pending entry and process with the old immediate Vision path so the image is not lost. Daily cleanup prunes stale metadata.
- Several independent bare photos are stored separately; the newest receives the next explanatory text, while other photos expire independently.

## Limitations and release gates
- Telegram Bot API cannot signal active typing to Support bot; fixed 60-second grace is used. Cloudflare delayed delivery is not a hard real-time SLA.
- Queues provides at-least-once delivery. Atomic D1 claiming limits double replies but an uncertain external Telegram send may still be retried after a crash; true end-to-end exactly-once delivery is not guaranteed.
- Cloudflare Queues is on Workers Free and includes 10,000 operations/day as of 2026-11-07; usage above plan allowances may incur charges on paid plans.
- Deploy only after additive D1 migration, Queue creation, passing unit+webhook tests and GitHub merge. Worker upload must preserve all existing secrets and add only new Queue binding. Register Queue consumer after deployment. Keep prior Worker version for rollback without dropping D1 or altering R2.
