# Stopの業務判断と監査修復を分離するアーキテクチャ

関連Story: [Stopの業務判断と監査修復を分離する](../user_stories/active/story-stop-decision-separation.md)

## 判断

Stopの判定を、業務上の次の行動とプロトコルの健全性に分ける。現在のHostは不足項目を一つの`missingCapabilities`へ集約しているため、監査行や状態記録の不足が、業務未完了と同じ`block`・`autonomy_continuation`として扱われる。これを一つの業務判定にしない。

内部では次の不変な判定結果を作り、Codex Hookの表現へ最後に変換する。

```text
StopDecision {
  stop_decision: {
    business_decision: RELEASE | CONTINUE | ASK_HUMAN
    protocol_status: ready | repair | degraded
    business_reasons: []
    protocol_reasons: []
    continuation_plan?: {
      trigger_code, reason_code, next_objective,
      allowed_scope, done_when, max_stop_attempts
    }
  }
  continuation: null | { stop_decision, trigger_code, event_sequence_boundary, attempt_count }
}
```

`stop_decision`内の`business_decision`は一つだけ、`protocol_status`は別軸で一つだけを持つ。既存final receiptのtop-level `protocol_status`（`audit_protocol_complete`/`audit_protocol_incomplete`）は後方互換のため維持し、新しい2軸は`stop_decision`へ入れる。監査修復の理由を`business_reasons`や業務継続マーカーへコピーしない。

## 判定順序

1. episodeをtransition lock内で再読込し、TurnContract、候補回答、同一episodeのevent、最新状態を固定する。
2. 業務判定を決める。業務の成功証跡と完了条件が揃えば`RELEASE`、安全な作業・検証が残れば`CONTINUE`、許可された実行時確認が必要なら`ASK_HUMAN`とする。監査行の有無だけではこの判定を変えない。
3. プロトコル判定を独立して決める。必要な可視監査行、状態tool、本文保持、value proof等を検証し、不足なら`repair`、監査不能なら`degraded`とする。
4. 2軸をHook出力へ変換する。業務継続だけが既存の有限継続マーカーを作り、監査修復だけは既存の一回限りの修復契約へ留める。

`CONTINUE`には継続計画を必須とする。計画は、何が継続を起こしたか、TurnContract上の理由、次に満たす目的、現在のturnで承認された範囲、完了条件、最大Stop試行回数を固定する。再開したモデルはこの範囲を拡張せず、境界後の実行・検証証跡と最後の状態記録で完了を示す。

## Hook出力への変換

| 業務判定 | protocol status | Hostの動作 | 業務継続マーカー |
| --- | --- | --- | --- |
| `RELEASE` | `ready` | final receiptを作りStopを通す | 作らない |
| `RELEASE` | `repair` | 監査形式だけを一回修復要求。本文を保持 | 作らない |
| `RELEASE` | `degraded` | 必要なら可視警告を一回だけ修復し、`audit_degraded`として確定。成功・完了と表示しない | 作らない |
| `CONTINUE` | `ready` | `decision:block`で安全な次作業・検証を要求 | 作る |
| `CONTINUE` | `repair` | 業務継続理由と監査修復理由を別々に返す | 業務分だけ作る |
| `CONTINUE` | `degraded` | 監査不能を記録し、通常権限の範囲を超えて作業を許可しない | 監査理由では作らない |
| `ASK_HUMAN` | `ready` | 許可された質問を含む`waiting_human`として確定 | 作らない |
| `ASK_HUMAN` | `repair` | 監査修復を先に要求し、質問の意味や本文を変えない | 作らない |
| `ASK_HUMAN` | `degraded` | 監査不能として確定し、確認を権限許可に読み替えない | 作らない |

実際のCodex Hookでは、`CONTINUE`を`decision:block`へ、`RELEASE`と`ASK_HUMAN`の確定を非block出力へ変換する。Hookの`systemMessage`は候補回答本文へ挿入されないため、既存の可視監査ブロックは回答本文の契約として引き続き検証する。

## 継続境界と有限性

- 現行TurnContractで`CONTINUE`となる場合だけ、業務継続マーカーに`event_sequence_boundary`と有限retry回数を持たせる。旧契約のrequired knowledge修復は互換経路に留め、新しい業務継続マーカーへ昇格しない。
- 状態tool、監査行の追加、価値証明の登録、将来の作業予定は業務実行証跡として数えない。
- 継続後の成功した作業・検証が境界より後に存在しない場合、継続完了とはしない。上限到達後は未解決として残す。
- `RELEASE`から`CONTINUE`へ遡及変換すること、また監査修復から業務継続へ昇格することは禁止する。
- `ASK_HUMAN`は契約で許可された理由、状態、候補質問が一致する場合だけ成立する。単なる丁寧な質問や確認語は人間確認の根拠にならない。

## 監査契約との境界

- `🧠`/`📚`/`⚠️`の可視監査ブロック、行順、重複禁止、元本文保持は現行契約のまま維持する。
- `protocol_status=repair`は監査契約の未達を表すだけで、業務の未完了、Brainbase参照成功、外部操作許可を意味しない。
- 監査修復が必要なときも、元の回答本文を保存し、監査行以外を削除・要約・置換しない。
- `audit_degraded`は`complete`や`task_complete`に集約せず、通常の権限・承認を置き換えない。

## 実装境界

- 変更対象は`judgment-resolver-host.mjs`のStop判定と、そのHost単体・回帰テストである。
- pre-turnの`brainbase_resolve_turn` schema、Brainbase MCP server、通常のexecutor権限、global Hook設定、稼働中runtimeは変更しない。
- 内部の2軸結果はjournal/final receiptに監査可能な形で残すが、回答本文へ内部判定JSONを表示しない。
- 欠測や不明な証跡は成功やゼロへ丸めず、該当する`repair`または`degraded`として残す。

## 却下した案

- 監査行・状態tool・value proofの不足を、すべて`CONTINUE`としてモデルへ再実行させる。
- `missingCapabilities`の文字列だけを変え、業務継続マーカーの生成条件を変えない。
- retry回数を増やすだけで、業務判断とプロトコル判断の混同を残す。
- Stopから候補回答を編集し、監査行を自動挿入して監査契約を満たしたことにする。
- pre-turn Resolverへ候補回答を追加し、既存の厳密schemaとHost journal契約を広げる。

## 検証境界

新しいHost単体テストでは、`RELEASE`、業務`CONTINUE`、`ASK_HUMAN`、監査のみの修復、両方不足の組合せを検証する。既存のrequired knowledge、本文保持、value proof、degraded、finite retry回帰も通す。これらはローカルadapterの証拠であり、Hook trust/readiness、fresh task、実Desktop表示、稼働runtimeの実効性は別のlive E2Eで確認する。
