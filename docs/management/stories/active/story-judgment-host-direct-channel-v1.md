---
story_id: story-judgment-host-direct-channel-v1
title: Codex Desktop上のBrainbase Judgment Resolver差し戻しループを構造的に閉じる
source_requirement:
  source: Codex conversation 2026-09-03
  approved_at: 2026-09-03
architecture_docs:
  - path: docs/architecture/story-judgment-host-direct-channel-v1.md
    status: accepted
spec_docs: []
pr_scope_strategy: atomic_single_pr
pr_scope_reason: "turn_ref直結・Host描画監査・ポリシー承認・Stop1回制限の4変更は、同じCodex Desktop差し戻しループという1つの症状に対する1つの契約変更であり、個別にPRを分けると中間状態が別の差し戻し不具合を生む。"
status: active
created_at: 2026-09-03
updated_at: 2026-09-03
---

# Codex Desktop上のBrainbase Judgment Resolver差し戻しループを構造的に閉じる

## Story

Codex Desktopで日々作業するownerとして、Brainbase Judgment Resolver hookが毎ターン差し戻し・承認要求を繰り返すことで生産性が落ちるのをやめたい。PR #1369〜#1375で個別症状を延命したが、原因は契約の前提がCodex Desktopで成り立たないことにある。この4つの前提を修正し、正常なturnはそのまま完全監査しつつ、Codex Desktop固有の制約下でも無限ループなく収束してほしい。

## 共有サービス境界の適用性

このStoryの対象は、単一利用者のローカルCLIとして動くCodex Host adapterのsession/turn監査だけである。外部主体ごとのデータ経路、認証情報、共有資源は読み書きしないため、主体別の分離契約は適用対象外とする。

## 確認した原因（今日の症状の共通構造）

1. モデルがHostとMCP serverの間でturn_inputを運ぶ前提だったが、Codex Desktopはhook contextを切り詰めるため、大きなturn_inputが失われることがあった（A）。
2. モデルがHostの監査行を回答先頭に再現する前提だったが、モデルの出力トークン予算やcontext切り詰めが監査の正しさに影響していた（B）。
3. 分類（action_kind=external または risk high/critical）からの自動escalationを毎ターン硬いゲートにしていたため、git push/merge/PR公開のような日常的な操作でも承認要求が発生し、かつ承認が消費されなかった（C）。
4. Stopが2回目以降も差し戻し／`judgment_stop_repair_exhausted`になり、無限ループが構造的に可能だった（D）。

## 受け入れ基準

- [x] AC-001（A）: UserPromptSubmitはturn_inputをjournalの`<sessionRef>/<turnRef>.turn-input.json`へ保存し、model contextには`turn_ref: "<sessionRef>/<turnRef>"`という参照だけを渡す。turn_inputのJSON本文やファイルpathはmodel contextへ渡さない。
- [x] AC-002（A）: `brainbase_resolve_turn`は`turn_ref`（推奨）と3つのlegacy形式（`{"turn_ref": ...}`、`{"turn_input_path": ...}`、turn_inputそのもの）を受理し、serverがjournal root配下のファイルパスを検証してから自分で読む。
- [x] AC-003（B）: Stopは監査ブロック（保存済み`🧠`行と全`📚`/`⚠️`/`🔁`/`🛠️`行）を自分でsystemMessageとして毎回描画する。モデルが回答本文へ監査行を書いても、Hostはそれを検証も要求もしない。
- [x] AC-004（C）: `autonomyResolution`は分類（risk/action_kind）だけからは自動escalateしない。escalateはneeds_classification、needs_policy_resolution、または適用policyの`human_approval`ルールが分類に一致する場合、の3つだけ。
- [x] AC-005（C）: `config/judgment-runtime-manifest.json`は真に人間承認が必要な操作（本番デプロイ・第三者への外部送信・共有データ削除・課金）にだけ`human_approval`を付けたpolicyを持ち、git push/merge/CI/再起動/ローカル反映/自社Slack投稿には付けない。
- [x] AC-006（C）: receiptは一致したpolicy idを`autonomy_policy_ids`へ記録し、MCP client・Hostの契約検証は分類からの再計算をやめて形（enum、reason⇔decision、allowlist、policy_ids配列）だけを検証する。
- [x] AC-007（C）: 人間が一度escalateへ回答したら、そのsession全体で有効になる（`<journal>/<sessionRef>/approvals.json`へ`{reason_code, policy_ids, approved_at, prior_turn_ref, turn_ref}`をappendし、以降のturnのautonomy_policy_ids／reason_codeが承認済みなら`continue`扱いにする）。使った承認はfinalへ`approval_ref`として残る。
- [x] AC-008（D）: 同一episodeで継続markerが既に存在する（1回block済みの）active再Stop（`stop_hook_active=true`）は、契約未達でも2度目の`decision:block`を返さず、`completion_status: 'audit_degraded'`・`degradation_reason`・`missing_capabilities`で確定し、監査ブロック末尾へ`⚠️ 監査縮退: <理由>`行を付けて通す。
- [x] AC-009（D）: `judgment_stop_repair_exhausted`の非zero終了は削除する。identity/integrity矛盾とtransaction timeoutは引き続きfail-closedで失敗する。
- [x] AC-010（D）: `audit_degraded`のfinalはknowledge outboxへ流れない（adapterは`completion_status !== 'complete'`を無視する）ことをテストで直接証明する。
- [x] AC-011: 同一Stop呼び出しの単純replay（`stop_hook_active`不変の重複呼び出し）は、既存の継続marker再利用による決定的な同一出力のまま保つ（AC-008のactive再Stop判定と混同しない）。
- [x] AC-012: unit/integrationで、first Stopのblock、active再Stopのaudit_degraded収束、3回目以降の同一final再利用、並行active Stopの一方block・他方audit_degraded、policy human_approval駆動のescalate、session持続承認の再利用と非該当policy/reason_codeでの再確認、を検証する。
- [ ] AC-013: VibePro Gateと独立reviewで、escalationが分類だけから発生しないこと・session承認がpolicy境界を超えて漏れないこと・`audit_degraded`がaction authorizationを拡張していないこと・2回目以降のStopが無限ループしないことを確認する。

## スコープ外

- Codex Desktop本体へのUserPromptSubmit相当eventの追加
- 分類matcher（intent/domain/risk/action_kind判定ロジック）そのものの見直し
- merge、配布、global Hook切替、本番反映
- merge、push、deploy、外部送信など既存の実行権限を緩和すること
- 3回目以降のStopでも変わらない`audit_degraded` final以外の新しい完了状態の追加
