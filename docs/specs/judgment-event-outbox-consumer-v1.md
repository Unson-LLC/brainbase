# Judgment event outbox consumer接続 v1

このSpecは、Unson runtimeの既存knowledge event配送をOSS `judgment-event-outbox`へ接続する候補を固定する。runtimeの本番切替を行うSpecではない。

## 接続候補

| runtimeの既存責務 | OSS接続位置 | 所有者を変えないもの |
| --- | --- | --- |
| `resolveJudgmentKnowledgeEventOutboxPath({ env, varDir, repoDir })` | `resolveJudgmentKnowledgeEventOutboxPaths({ varDir })` の結果をHost sinkへ渡す | runtimeの環境変数解決、共有 `varDir` の選択 |
| `enqueueJudgmentKnowledgeEvent(event, { directory })` | `createJudgmentKnowledgeEventOutboxSink({ paths }).enqueue(event)` | Hostのfinalize、Task/continuationの保存 |
| `deliverJudgmentKnowledgeEventOutbox(...)` のPOST | `JudgmentOutboxDeliveryPort.post(event)` | endpoint、service token、organization ID、HTTP statusの解釈 |
| cycle receipt GET/readback | `JudgmentOutboxDeliveryPort.readback({ event, post })` | canonical readback URL、tenant scope、receipt schemaのHTTP adapter |
| `judgment-resolver-host.mjs` のsender lock | `deliverJudgmentKnowledgeEventOutbox({ paths, delivery })` の共通lock | runtimeの起動・停止とdelivery workerのスケジュール |

## 変わらない契約

- `varDir` は必ずruntimeから明示注入する。OSS coreはcwd、repoの絶対パス、環境変数、secretを推測しない。
- `event_id` の同一内容enqueueは既存キューを返し、同一IDで本文が変わればconflictにする。
- `event_id` は安全な文字集合（英数字開始、英数字・`.`・`_`・`:`・`-`、最大256文字）に限定し、保存ファイル名は常に `${event_id}.json` と一致させる。
- 本番のNode storageは完全書込済み一時ファイルをhard linkで排他的に公開する。`EEXIST`時は勝者を再読して同一本文だけを`existing`として受け入れ、別本文はconflictにする。custom storageも`link(from, to)`を必須実装とし、未実装なら`judgment_event_outbox_atomic_link_required`でfail-closedにする。部分書込を見せるstorage実装は本番接続に使わない。
- POST成功後のreadback失敗ではPOST ackをキューへ保持し、再試行時にPOSTを再送しない。
- transport障害ではpost attemptを消費しない。HTTP 409または上限超過はdead-letterへ移す。
- confirmed receiptのreadbackが取れるまでキューを削除しない。receiptにはevent/candidateの同一性と `retrievable`/`active` を保存する。

## outboxレコードの入力検証

配送前に、トップレベルのschema version、`event`、`event.event_id`、`delivery` を検証する。ファイル名と `event_id` の対応も同時に検証し、schema不一致、危険なID、ファイル名不一致、必須構造欠落のレコードはネットワークへ送らずdead-letterへ移す。診断・例外一覧でも同じファイル名検証を適用する。

## 1a980d01との接続根拠

実runtime正本 `brainbase-31013` の `server/services/routine-runtime/judgment-event-outbox.js` は、path解決、atomic enqueue、post/readback、receipt、dead-letterを一つの実装に持つ。`judgment-resolver-host.mjs` は送信lockとworker起動を所有する。今回のOSS coreはその保存・再送・lockの共通部分だけを移し、runtime固有の `organizationId`、credential、endpoint、Task/receipt bindingは `JudgmentOutboxDeliveryPort` とHost adapterに残す。

## 切替前に必要な確認

1. runtime adapterで既存HTTP/auth/readbackを `JudgmentOutboxDeliveryPort` のpost/readbackへ適合する。
2. 現行runtimeとOSS coreに同一fixtureを投入し、queue JSON、attempt/readback_attempt、receipt、dead-letter、lock busyの基準比較を行う。
3. 固定版 `resolve_turn` とreceipt readbackを含むconsumer pack smokeを行い、旧配置を残したまま切替候補をレビューする。
4. runtime pin、Hook/live切替、旧配置削除、npm publish、merge、本番配備は別途承認を得る。
