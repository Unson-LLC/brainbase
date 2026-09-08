---
story_id: story-stop-decision-separation
title: Stopの業務判断と監査修復を分離する
status: active
created_at: 2026-09-06
---

# Stopの業務判断と監査修復を分離する

AIの候補回答が終わった後、Brainbaseの判断に基づいて「回答を確定する」「承認済み範囲の作業を続ける」「人間に確認する」を決めたい。監査行、状態記録、証跡の不足は業務の未完了とは別の問題として扱い、形式修復だけで作業継続を要求しない。

## 受入条件

1. Stopは候補回答と同一episodeの証跡から、業務判断を`RELEASE`、`CONTINUE`、`ASK_HUMAN`のいずれか1つに確定する。
2. 監査・形式の状態は業務判断から独立して、`ready`または`repair`（必要なら`degraded`）として記録する。監査修復だけを理由に`CONTINUE`を作らない。
3. `RELEASE`は業務上の完了条件と監査契約の両方が満たされた場合だけ、final receiptを作る。監査表示を成功や業務完了の証拠にしない。
4. `CONTINUE`は安全な残作業・検証が実際に残る場合だけ、`decision:block`と有限の業務継続マーカーを返す。状態登録、監査行の追加、予定の説明だけでは継続完了としない。
   - 同じ判断結果に、継続理由、次の目的、許可範囲、完了条件、最大Stop試行回数を固定する。
5. `ASK_HUMAN`は契約で許可された確認理由に一致する候補質問だけを通し、安全な継続マーカーを作らない。通常の権限・承認境界は変更しない。
6. 候補回答に必要な可視監査ブロックがない場合でも、監査のみの修復は元の業務本文を保持する一回のプロトコル修復として扱い、業務継続の理由・回数・実行境界へ混ぜない。既存の可視監査ブロック契約はこのStoryでは維持する。

## 最小Spec

- 対象は`Stop`を処理するHost adapterとその単体テストである。Brainbaseのpre-turn `brainbase_resolve_turn` schema、通常のexecutor権限、global Hook配布は変更しない。
- Hostは一度のStopで`stop_decision`として次の2軸を確定する。
  - `stop_decision.business_decision`: `RELEASE` / `CONTINUE` / `ASK_HUMAN`
  - `stop_decision.protocol_status`: `ready` / `repair` / `degraded`
- `business_decision`はTurnContract、候補回答、同一episode内の成功した実行証跡、状態記録、許可された確認理由から決める。`protocol_status`は監査行、状態tool、回答本文保持、必要な証跡形式から決める。
- `stop_decision.business_decision=CONTINUE`のときだけ、既存の有限retry機構へ業務継続マーカーを追加する。`stop_decision.protocol_status=repair`だけでは`autonomy_continuation`を追加しない。
- `CONTINUE`の`continuation_plan`は`trigger_code`、TurnContract由来の`reason_code`、`next_objective`、`allowed_scope`、`done_when`、`max_stop_attempts`を持つ。再開時に継続理由や範囲を推測し直さない。
- 両方が不足する場合は、業務継続の不足と監査修復の不足を別々の理由・状態として返す。一方の修復で他方を満たしたことにしない。
- `RELEASE`と`ASK_HUMAN`は、必要な監査契約が満たされるまで確定できない。ただし監査修復の要求は業務継続マーカーではない。
- 最終回答先頭の`🧠`/`📚`/`⚠️`監査ブロックと、本文を保持する既存契約は維持する。Stopの`systemMessage`が可視回答本文へ自動挿入されないCodexの境界も変えない。

## Phase 1テストケース仕様

1. **RELEASE: 業務・監査ともに完了**（正常系）
   - 成功した実行証跡、完了状態、必要な監査ブロック、本文保持が同一episodeに揃った候補回答を入力する。
   - 期待値: `business_decision=RELEASE`、`protocol_status=ready`、Stopはblockせずfinal receiptを1件作る。`autonomy_continuation`は作らない。

2. **CONTINUE: 安全な残作業がある**（正常系）
   - 実装・操作turnで、監査ブロックと状態記録は揃っているが、候補回答が方針説明だけで安全な作業・検証を終えていない入力を使う。
   - 期待値: `business_decision=CONTINUE`、Stopは`decision:block`、理由は次に実行すべき作業・検証を示し、業務継続マーカーだけを有限回数で保存する。状態登録や完了宣言だけを実行証跡として数えない。

3. **ASK_HUMAN: 許可された確認が必要**（境界値）
   - TurnContractが許可した`missing_authority`などの確認理由と一致する`waiting_human`状態、およびその理由を先頭に示す候補質問を入力する。
   - 期待値: `business_decision=ASK_HUMAN`、業務継続マーカーは作らず、質問と`waiting_human`をfinal receiptへ保存する。許可されない質問は`ASK_HUMAN`に昇格しない。

4. **監査のみの修復: 業務は完了している**（異常系）
   - 業務上の成功証跡と完了状態は揃っているが、候補回答の可視監査行または専用状態記録だけが不足している入力を使う。
   - 期待値: `business_decision=RELEASE`のまま、`protocol_status=repair`として一回だけ監査修復を要求する。`autonomy_continuation`、業務継続回数、`unfinished_safe_work`を作らず、元の本文を削除・要約・置換しない。

5. **業務と監査の不足を混同しない**（組合せ境界）
   - 業務上の実行証跡が不足し、同時に監査行も不足する候補回答を入力する。
   - 期待値: `business_decision=CONTINUE`と`protocol_status=repair`を別々に返す。業務継続要求は実作業・検証の不足にだけ対応し、監査修復の完了や監査行の追加だけで業務継続条件が満たされたことにしない。継続後に実行証跡が増えなければ、有限上限到達時は未完了として残す。

## スコープ外

- Brainbaseへ候補回答を送る新しいpost-answer MCP APIの追加
- `RELEASE`等の判断で外部操作・merge・deploy・公開を自動許可すること
- 既存の可視監査ブロック、監査行の順序、本文保持契約の廃止
- 稼働中runtime、global hooks設定、信頼情報の変更

## 検証境界

Host単体テストと既存Stop回帰テストで、判断軸の分離と有限継続を確認する。テスト成功だけでは、稼働中CodexのHook trust、fresh task、Desktop表示、実際の実行再開を証明しない。反映後は別途、標準readiness確認と新規taskの実ログで検証する。
