---
story_id: story-m2-codex-proxy-judgment-loop
title: M2 Codex代理判断ループと人間エスカレーション境界
status: active
category: product
spec: docs/specs/m2-codex-proxy-judgment-loop.md
architecture: docs/architecture/story-m2-codex-proxy-judgment-loop.md
canonical_story_path: docs/management/stories/active/story-m2-codex-proxy-judgment-loop.md
created_at: 2026-08-30
updated_at: 2026-08-30
---

# M2 Codex代理判断ループと人間エスカレーション境界

## Intent

BrainbaseをMCP接続したCodexの利用者として、最初の依頼後にCodexが安全で可逆な通常工程や実装上の選択を人間へ確認しようとしたとき、Brainbaseに保存された目的・判断基準・過去Decision・委任境界をCodex自身または独立Resolverへ適用させ、OK / NG・理由・代替指示・完了条件を作業へ戻して同一ターンで続行させたい。これにより、人間は既に決めた意図の再説明と細かい承認から解放され、本当に新しい価値判断・権限・不可逆操作だけを受け取れる。

## 受け入れ基準

- [x] AC-001: Stop時の最終回答から、監査行を除いた人間への確認・選択・承認要求を検出し、通常の完了回答と、accepted Judgment Receiptが明示的に選んだclarificationは既存finalizationへそのまま渡す。
- [x] AC-002: テスト、読取、調査、ローカルで可逆な変更など明白な通常工程の確認はLLMを呼ばず`continue`と判定し、同じCodexターンへ具体的な続行指示を返す。
- [x] AC-003: 外部送信・公開・本番操作・破壊的変更・権限変更・機密/個人情報・金銭/法的コミット・実証済み権限不足・新しいowner価値判断はfail-closedで`human_required`とする。レビュー済みrelease pipelineを元依頼が明示した場合だけ同じrelease操作の重複確認を省き、外部message deliveryは常に人間境界へ残す。判断receiptだけで権限を増やさない。
- [x] AC-004: 明白な二分類に入らない意味的グレーゾーンは、差し替え可能なread-only Resolver Providerへ構造化caseを渡せる。Provider未設定時は現在のCodexをResolverとしてBrainbase MCP参照へ戻し、人間へ質問せず続行する。
- [x] AC-005: 独立Resolverの返答はcase ID、schema、verdict、根拠、`continue`時のinstruction patchをHostが検証し、別caseの判断、根拠なしの権限拡張、不完全な返答をfail-closedで拒否する。
- [x] AC-006: 自律差し戻しは既存の監査repairとは別理由として扱い、同じ差し戻し後も人間質問を繰り返した場合は無限ループにせずfail loudする。完了時は既存audit contractを維持する。
- [ ] AC-007: 現行`develop`の`judgment-host`回帰、追加unit、build、typecheckを同一HEADで通し、既定off・単一project canary・immutable autonomy receiptを検証する。実Codex Hookで「テストしますか？」が人間へ届かず同一ターンで実行されるE2E証拠はcanary環境のexact release HEADで取得する。

## 境界

- Brainbase CoreへLLMを埋め込まない。Brainbaseは判断基準・過去判断・scope・委任境界の正本であり、意味適用はWorker CodexまたはResolver Providerが担当する。
- このStoryの既定経路は現在のCodexを再開するP0である。Codex SDK/CLIを直接起動する特定provider、managed OpenAI API provider、他モデルproviderは同じ契約を実装する後続adapterとする。
- Hookは外部送信、deploy、merge、購入、契約、本番削除を許可しない。既存のHost permission/approval境界を維持する。
- Autonomy Gateは既定`off`とする。最初の本番導入は`--autonomy-mode canary --autonomy-project brainbase`で24時間、Brainbase projectだけを対象にし、顧客project、契約、請求、人事、本番データ操作を対象にしない。全体`on`はcanary証拠のレビュー後に別途昇格する。
- 各判定は質問本文を保存せずdigest、mode、project、case、verdict、reason、source、basis IDをimmutable receiptとして保存する。
- 一般的な回答の正しさやハルシネーション全般は保証しない。ここで保証するのは、人間エスカレーション境界とResolver返答のcase bindingである。

## 完了証拠

Story・Architecture・accepted Spec、pure autonomy classifier、Host統合差分、unit/integration testを一つの変更集合へ束縛する。exact HEADでfull regression、build、release validationを通し、単一project canaryのHook receiptを取得する。実Codex同一ターン再開と24時間readbackが未取得の間はAC-007を未完とし、`production_proven`とは表明しない。
