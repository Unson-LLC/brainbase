# 初心者向けオンボーディング投影 Spec

親 Story: [初心者が安心して完了できるオンボーディング](../stories/beginner-safe-onboarding-story.md)
親 Architecture: [初心者向けオンボーディング投影](../architecture/beginner-safe-onboarding-architecture.md)

## オンボーディング結果

各 `brainbase_onboarding_*` の結果は、既存フィールドを保持したまま次を先頭に追加する。

- `guide.current`: 現在地を表す日本語の1文。
- `guide.completed`: 完了済み事項の日本語配列。
- `guide.remaining`: 残っていることを表す日本語の1文。
- `nextAction`: 次のツール、短い日本語ラベル、日本語の操作説明、必要ID。
- `nextAction.confirmation`: 実行で変わるもの、可逆性、安全な復旧方法。
- 完了状態では `nextAction` は `null`、`guide.remaining` は「ありません。」とする。

表示順は `guide`、`nextAction`、既存の実行状態、`runId` とする。

## Ontology 1.0.0 結果

`get_ontology.beginnerGuide` は正式契約より前に次を返す。

- まず読む日本語の1文。
- 意思決定の置き換えを使った日本語の業務例。
- 5要素それぞれの日本語名、問い、例。
- 誤定義時の確認・影響調査・版更新への導線。
- 正式契約を読む必要がある人向けの案内。

既存の `suggestedNextTools` と正式な Ontology 1.0.0 契約は変更しない。

## テスト条件

1. 初期・候補レビュー・完了の各状態で案内が正しい。
2. 候補レビュー前に変更内容と可逆性が読める。
3. 初心者ガイドに日本語の業務例と5要素がある。
4. 既存の機械可読フィールドと Ontology version `1.0.0` が維持される。
5. 実画面で同じ2タスクを再実行し、32人中7人以上が重大な迷いなしで完了する。
