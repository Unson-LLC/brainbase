---
story_id: story-judgment-host-direct-channel-v1
title: Judgment Resolver Host direct channel, session approval, and one-block Stop
status: accepted
---

# Architecture: Judgment Resolver Host direct channel

## マルチテナント適用性

この設計は単一利用者のローカルCLI Host adapter内のsession/turn監査に閉じる。tenant、顧客、組織ごとのデータ経路、認証情報、共有資源を新設・変更しないため、マルチテナント境界契約は適用対象外である。

## Decision

Codex Desktop上でBrainbase Judgment Resolver hookが毎ターン差し戻し・承認要求を繰り返した根本原因は、既存契約の前提がCodex Desktopで成り立たないことにあった。4つの独立した変更でこの前提を修正する。

1. **Host↔server直結（turn_ref）**: モデルがHostとMCP serverの間でturn_inputを運ぶ前提をやめる。HostはUserPromptSubmit時にturn_inputをjournalへ保存し、`<sessionRef>/<turnRef>`という64桁hexペアの参照だけをmodel contextへ渡す。MCP serverはこの参照からjournal内のファイルを自分で読む。
2. **Host自身が監査行を描画**: モデルがStopの回答本文へ監査行（`🧠`/`📚`/`⚠️`/`🔁`/`🛠️`）を再現する前提をやめる。HostがStopのsystemMessageとして監査ブロックを毎回自分で描画し、モデルの回答本文はもう検証・要求されない。
3. **ポリシー明示の承認 + session持続の承認**: 分類（risk/action_kind）からの自動escalateをやめる。escalateはneeds_classification、needs_policy_resolution、または適用ポリシーが`human_approval`を明示して分類が一致する場合、の3つだけ。人間が一度承認したら、そのsession全体で有効にする（`approvals.json`）。
4. **Stopは最大1回しか止めない**: 同一episodeで継続markerが既に存在する（1回差し戻し済みの）active再Stopは、契約未達でも`decision:block`を返さず`audit_degraded`で確定し、無限差し戻しループを構造的に閉じる。

## State model（変更2・4の中心）

```text
UserPromptSubmit
  -> starting --transition lock--> open (turn_input を journal へ保存し turn_ref だけ model へ渡す)
  -> start_failed

open --PostToolUse under lock--> open + immutable event (Hostが自分でaudit行を保存)
open --Stop under lock--> repair_once | complete | audit_degraded

repair_once（初回block、継続marker作成）
  --active re-Stop, marker既存, まだ不足--> audit_degraded（block しない）
  --active re-Stop, marker既存, 全部揃った--> complete

audit_degraded != complete
audit_degraded -/-> knowledge outbox
```

## Components

### 1. Host↔server direct channel（turn_ref）

- `journalPaths(sessionRef, turnId, env).turnInput` が `<sessionRef>/<turnRef>.turn-input.json` を指す。UserPromptSubmitはこのファイルへturn_inputを保存し、bootstrap contextには`turn_ref: "<sessionRef>/<turnRef>"`だけを渡す。
- `brainbase_resolve_turn` MCP toolは`turn_ref`（推奨）、legacy `turn_input: {"turn_ref": "..."}`、`turn_input: {"turn_input_path": <path>}`、turn_inputそのもの、の4形式を受理する。serverはjournal root配下のファイルパスを検証（`realpathSync`でsymlink解決し、journal root配下かつ`.turn-input.json`拡張子であることを確認）してから自分で読む。
- turn_inputのJSON本文やファイルpathはmodel contextへ一切渡らない。Codex Desktopがhook contextを切り詰める問題を構造的に回避する。

### 2. Hostが自分で監査行を描画

- `finalizeEpisodeLocked`の`completedAuditOutput`が`requiredAuditLines(episode, events, existingContinuation)`からsystemMessageを毎回組み立てる。
- モデルが回答本文へ`🧠`/`📚`/`⚠️`/`🔁`/`🛠️`行を書いても、Hostはそれを検証も要求もしない（再現・echoは不要）。
- これにより、モデルの出力トークン予算やcontext切り詰めが監査の正しさに影響しなくなる。

### 3. ポリシー明示の承認 + session持続の承認

- `server/services/judgment-resolution-service.js`の`autonomyResolution`は、`manifest.autonomy.escalate_risks`/`escalate_action_kinds`（現在は`[]`、schema検証のみ残る）を一切参照しない。escalateは(1)`needs_classification`→`classification_missing`、(2)`needs_policy_resolution`→`policy_conflict`、(3)適用policyの`human_approval: { action_kinds?, risks? }`が分類の`action_kind`/`risk`に一致→`risk_or_external`、の3つだけ。
- receiptは一致したpolicy idを`autonomy_policy_ids`へ記録する（該当なしは`[]`）。
- `config/judgment-runtime-manifest.json`に`global.high-stakes-human-approval.v1`（`human_approval.risks: ["critical"]`）を1つだけ追加した。本番デプロイ・第三者への外部送信・共有データ削除・課金など真に人間承認が必要な操作にだけ付き、git push/merge/CI/再起動/ローカル反映/自社Slack投稿には付かない。
- MCP client（`isJudgmentReceipt`）とHost（`verifyAutonomyContract`）は、分類からexpected reasonを再計算して一致を要求するのをやめ、enum・`routine_in_scope`⇔continue／それ以外⇔escalate・`allowed_runtime_escalation_reasons`（continueは固定list、escalateは`[]`）・`autonomy_policy_ids`の形だけを検証する（server-owned manifestが決定を一元化する）。
- Hostのsession持続承認: turn開始時に`previousTurnEscalated(...)`が「直前turnは`risk_or_external`で人間待ちだった」と判定したら、`<journal>/<sessionRef>/approvals.json`（append-only JSON配列、atomic temp-file+renameで更新、idempotent）へ`{reason_code, policy_ids, approved_at, prior_turn_ref, turn_ref}`を追記する。以降のturnでは、resolved receiptが`risk_or_external`でescalateしても、その`autonomy_policy_ids`が全てapprovals.jsonで承認済み（policy_idsが空なら同じreason_codeの承認があればよい）なら`continue`として扱う（`episodeAutonomyContract`が`approvalRef`を返す）。使った承認はfinalへ`approval_ref`として記録する。bootstrap contextにはsession承認済みのpolicy id/reason codeを1行で伝える。

### 4. Stopは最大1回しか止めない

- `finalizeEpisodeLocked`は`missingCapabilities`（`judgment.resolve_turn`/`knowledge.resolve`/`judgment.value_proof.record`/`autonomy.continuation`）を計算した後、`stopAlreadyBlockedOnce = missingCapabilities.length > 0 && existingContinuation !== null && payload.stop_hook_active === true`を判定する。
- `stopAlreadyBlockedOnce`がtrueなら`decision:block`を返さず、`completion_status: 'audit_degraded'`、`degradation_reason: <missingCapabilities[0]>`、`missing_capabilities: [...]`でfinalを確定し、systemMessage末尾へ`⚠️ 監査縮退: <理由>`行を1行付ける（final読み込み時のreplayでも同じ行を再現する）。
- `stop_hook_active === true`を条件に含めるのは、同一Stop呼び出しの単純replay（同じpayloadの重複呼び出し、`stop_hook_active`は変わらない）を、既存の継続marker再利用による決定的な同一block出力のまま保つため。Codexの「アクティブ再試行」シグナル（`stop_hook_active: true`）が来て初めて「1回目のblockはもう消費した」と判断する。
- `processHookPayload`から`judgment_stop_repair_exhausted`の非zero終了を削除した。identity/integrity矛盾（`judgment_episode_identity_missing`等）とtransaction timeoutは別経路で引き続きfail-closedのまま。
- `audit_degraded`のfinalは`server/services/routine-runtime/judgment-event-adapter.js`の`toKnowledgeEventFromJudgmentEpisode`が`completion_status !== 'complete'`を理由に無視するため、knowledge outboxへは決して流れない（既存の防御を維持しつつ、テストで直接証明した）。

## Authority boundary

`audit_degraded`はaction許可ではない。PreToolUse、git push Gate、merge、deploy、公開、外部送信などの既存authority guardは変更しない。`approval_ref`は「Hostが人間の承認を確認した」記録であり、通常の権限・承認を置き換えない。

## Rejected alternatives

- turn_inputを毎回model contextへinlineし、大きさをtruncateへ委ねる。
- モデルに監査行の再現を求め続け、context切り詰め時だけ緩和する。
- 分類（risk/action_kind）から自動escalateする既存ルールを維持し、routineなgit push/merge/PR公開を毎回止める。
- 直前turnだけを承認の有効範囲にし、2ターン以上前の承認を毎回失効させる。
- active再Stopを無制限に繰り返し許可する、または非zero終了で人手復旧を強制する。

## Evidence boundary

local testはHost adapter・server・MCP clientの契約検証を証明する。実Codex Desktop E2E、global Hook配布、長時間taskの継続は、明示承認後の別Gateでのみproduction provenにできる。

## Independent review Gate

local PR readinessには、実装sessionと分離したVibePro reviewが必要である。reviewは少なくとも、(a) escalationが分類だけから発生しないこと、(b) session承認がpolicy id/reason code境界を超えて漏れないこと、(c) `audit_degraded`がaction authorizationを拡張していないこと、(d) 2回目以降のStopが無限ループしないこと、を独立に確認する。test passだけではこのGateを代替できない。

## Regression boundary

journal layout（`journalPaths`）とスキーマ名は互換維持し、新規フィールド（`autonomy_policy_ids`、`approval_ref`、`missing_capabilities`、`approvals.json`）は追加のみである。正常に完了するepisodeのrequired knowledge、owner監査行、回答本文digest、exactly-one complete final契約は変更しない。
