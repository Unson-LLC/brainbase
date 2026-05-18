---
story_id: str.brainbase.sns-posted-content-dedupe
title: SNS posted content dedupe architecture
status: active
---

# Architecture: SNS posted content dedupe

Keep dedupe at the SNS Posting Ledger boundary. Generators can improve later, but the ledger is the last deterministic gate before a post appears in the review calendar.

The duplicate key is normalized body text scoped to `account_id`. It intentionally does not rely on X IDs, because manually posted content may not have been reconciled yet. The import response exposes skipped rows so `/ohayo` and UI operators can see that content was rejected rather than silently missing.

E2E isolation belongs in the test server bootstrap command. Production and canonical local runtime keep using `WORKSPACE_ROOT/var` or PostgreSQL, while Playwright defaults to `var/e2e-runtime` to avoid writing fixtures into the operator ledger.

