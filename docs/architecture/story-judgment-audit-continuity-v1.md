---
story_id: story-judgment-audit-continuity-v1
title: Judgment audit continuity architecture
status: accepted
---

# Architecture: Judgment audit continuity

## マルチテナント適用性

この設計は単一利用者のローカルCLI Host adapter内のsession/turn監査に閉じる。tenant、顧客、組織ごとのデータ経路、認証情報、共有資源を新設・変更しないため、マルチテナント境界契約は適用対象外である。

## Decision

監査状態とtask継続状態を分離する。完全なepisodeがあるturnだけを`complete`にできる。Codex内部continuationのようにmodel生成前のHost lifecycleが存在しないturnは、Stopからrouteを復元せず`audit_degraded`として確定する。`audit_degraded`は監査成功ではないが、Hook processの非zero終了によって長時間taskを人手待ちにしない。

同時に、正常経路の誤ったepisode欠損を防ぐため、episodeの存在確認をtransition lockの外で行わない。`startEpisode`、`recordBrainbaseToolUse`、`finalizeEpisode`は同じidentityからpathを導出し、lock取得後にepisodeを読む。

## State model

```text
UserPromptSubmit
  -> starting --transition lock--> open
  -> start_failed

open --PostToolUse under lock--> open + immutable event
open --Stop under lock--> repair_once | complete

no episode --first Stop--> repair_once + immutable orphan diagnostic
no episode --active Stop--> audit_degraded + immutable degraded receipt
audit_degraded --late Start--> terminal start conflict
orphan tool marker --late Start--> terminal start conflict

audit_degraded != complete
audit_degraded -/-> prior finalized judgment
```

## Components

### Serialized episode transition

- payload identityを検証し、journal pathを導出する。
- transition lockを取得する。
- lock内でepisodeを再読込する。
- episodeがあればevent記録またはfinalizeを行う。
- episodeがなければ、正常な開始処理がcommitするまで待った後の真のorphanとして扱う。
- lock timeoutは`not_found`へ丸めず、既存のtimeout reasonを保つ。
- 既定のtransition待機は50秒とし、Hostの初期Resolver最大3回・各15秒の予算とscheduler余白を包含する。明示的な短いoperator overrideは維持し、超過時は可視failureにする。
- orphan PostToolUseは判断episodeへ帰属させず、digest-onlyのorphan event markerと可視警告を残す。Stop専用のone-shot degraded stateは消費しない。

### Lock wait budget

既定の50秒は初期Resolverの最大3回・各15秒とscheduler余白を包含する。明示的な短いoperator overrideは維持するが、超過を`not_found`や成功へ変換せずterminal timeoutとして可視化する。

### Race scenarios

Startがlockを保持している間にPostToolUseまたはStopが到着しても、開始transactionのcommitまたはrollbackまで待つ。commit後は同じepisodeへeventを一度だけ記録してStopを確定し、rollbackまたはtimeoutは既存reasonのまま失敗する。

### Orphan diagnostic and degraded receipt

- 最初のorphan Stopはimmutable diagnosticを保存し、回答本文保持付きの警告行追加を`decision:block`で1回だけ要求する。
- active再Stopは同じdiagnosticへ束縛したimmutable degraded receiptを保存し、exit 0で終える。
- degraded receiptは`completion_status: audit_degraded`とし、警告行表示・本文保持の検証結果を個別に保存する。
- raw `session_id`、`turn_id`、回答本文、secret、Brainbase response本文は保存しない。
- orphan tool markerもraw tool名・tool use ID・input/output本文を保存せず、各digestだけを保持する。
- degraded receiptは既存の`.final.json`を使わず、complete finalの探索・prior receipt採用から構造的に分離する。
- orphan diagnostic、degraded receipt、またはorphan tool markerが確定した同一identityへ遅れてStartが到着してもepisodeを作らず、immutable state barrierとしてterminal conflictにする。markerはraw eventを保持しないため、後発episodeへの再結合は完全監査を偽装する。そのため、このintegrity conflictは有限収束の対象に丸めない。

### Orphan scenarios

最初のorphan Stopだけが回答再生成を要求する。active再Stopは警告表示や本文保持の成否をreceiptへ記録して非blockで終わる。警告は作業継続済みと利用者操作不要を明記する。orphan Brainbase PostToolUseは独立markerを残し、Stopのfirst/active判定を進めない。marker先行後のlate Startは完全監査を作れないためterminal conflictにする。

### Integrity boundary

監査対象のBrainbase PostToolUseでidentityまたは`tool_use_id`が欠ける場合は、曖昧なjournalへ結合せず非zeroで失敗する。runtime 2.3では、identityと`tool_use_id`が揃った非Brainbase toolをowner非表示のcompletion evidenceとしてepisodeへ記録し、欠落した一般toolやorphan一般toolは完全性を偽装しないよう無視する。既存の診断、degraded receipt、orphan markerは、厳密なschema、digest、boolean、正規ISO timestampを再検証し、不一致をterminal conflictにする。

UserPromptSubmitだけはHook protocol上の通知チャネルが異なる。orphan artifact確定後のlate Startはprocess exit 0のまま`blockedOutput.continue: false`を返して意味的にfail closedし、episodeを作らない。このprotocol上の正常終了は監査成功でも`audit_degraded`でもない。Brainbase PostToolUseのidentity/tool metadata欠損と、Stop時のartifact・digest・timestamp・lock conflictは引き続きprocess nonzeroで失敗する。

### Terminal failures

identityや必要なtool metadataの欠損、project/authority矛盾、immutable artifactのschema/digest/timestamp矛盾、lock timeoutはterminal failureである。UserPromptSubmitのlate Start conflictは`blockedOutput.continue: false`、Brainbase PostToolUseとStopのconflictはprocess nonzeroという各Hook eventの契約で通知する。いずれも`audit_degraded`へ丸めない。

### Privacy and evidence

orphan artifactはraw ID、回答本文、tool input/output、Brainbase responseを保存せず、digest、件数、理由、表示検証boolean、正規ISO timestampだけを保持する。

### Immutable receipts

同じevidence projectionの再実行は同一artifactを再利用し、異なるprojectionは衝突として失敗する。degraded receiptは`.final.json`、complete final、prior receiptの探索対象に含めない。

### Owner-visible repair

最初のblockはHost生成の警告行を最終回答の先頭へ追加し、元の回答本文を変更しないよう要求する。active再Stopで表示が不完全でも再度blockせず、receiptへ`owner_warning_displayed: false`または`answer_body_preserved: false`として残す。これによりunknownを成功へ変えず、同時に無限再生成を防ぐ。

## Authority boundary

`audit_degraded`はaction許可ではない。PreToolUse、git push Gate、merge、deploy、公開、外部送信などの既存authority guardは変更しない。監査不能を理由に外部操作を許可してはならない。

## Rejected alternatives

- Stopから初期route receiptを新規作成し、完全監査と呼ぶ。
- 同sessionの最新episodeを無条件で別turnへ流用する。
- orphan Stopを無記録の`{}`で通す。
- active再Stopを非zeroにして、新しいtask作成を恒久的な回復手段にする。
- 警告が表示できるまで無制限に`decision:block`を返す。

## Evidence boundary

local testはHost adapterの直列化とdegraded receipt契約を証明する。Codex内部Goal continuationを含む実Desktop E2E、global Hook配布、長時間taskの継続は、明示承認後の別Gateでのみproduction provenにできる。

## Independent review Gate

local PR readinessには、実装sessionと分離したVibePro reviewが必要である。reviewは少なくとも、missing episodeやprocess exit 0をcomplete auditへ偽装していないことと、`audit_degraded`がaction authorizationを拡張していないことを独立に確認する。test passだけではこのGateを代替できない。

## Regression boundary

episodeが正常に開始されたturnのrequired knowledge、owner監査行、回答本文digest、one-shot repair、exactly-one complete finalは既存契約と同じである。今回のdegraded経路を正常episodeへ適用しない。
