# Stage 3 OSS common contracts specification

## Run receipt

`normalizeRunReceipt(payload)`は、`run_receipt.v1` envelopeを検証し、次を返す。

- `source`: `mana`、`codex_automations`、`github_actions`、`salestailor`、`openryoko`、`openclaw`のいずれか。
- `run`: project、external run、status、evidence、timestamp、metrics、evidence refsを正規化する。本文、raw log、transcript、customer text、payloadは受け付けない。
- `delivery`: canonical `idempotency_key`、attempt、sent_at。
- `immutable`、`payload_digest`、`identity`、`projection`。

`createRunReceiptIdentity`は`projectId`、`sourceType`、`externalRunId`からrun identityを、workflow idからworkflow identityを決定する。同じexternal runでもprojectまたはsourceが違えばidentityを分離する。OpenClawは完全なcron task run IDとworkflow job IDの一致を要求する。

## Meeting automation

`assertMeetingCandidatesInput`はTask/Decision候補を各最大5件、タイトル必須、任意文字列の長さ上限付きで検証する。`normalizeTaskCandidates`と`normalizeDecisionCandidates`は候補を`candidate`状態として正規化し、source evidenceを保持する。`normalizeFollowUpDraft`は`draft_only`と`external_send_required_approval: true`を必ず返す。

`verifyMeetingReviewPackage`は議事録、Task候補、Decision候補、フォローアップ、昇格候補を必須出力として検証する。`loop_intent_ids`の全必須keyについてrepositoryから取得し、対象org/project以外のintentを拒否する。外部送信・Graph昇格・Task作成はこの契約の責務ではない。

## Existing canonical and migration state

3bは既存OSS canonicalを再利用し、Personal KGの正本を変更しない。`routines`の`ohayo`、`oyasumi`、`retro`とweekly scheduleを保持する。3c/3dの新subpathはconsumer準備段階であり、公開package publish、本番readback、旧path削除、runtime切替が完了するまで、台帳状態は`migration_pending`である。

## Verification

- `npx vitest run tests/run-receipt.test.ts tests/meeting-automation.test.ts`
- `npm run build`
- `git diff --check`
