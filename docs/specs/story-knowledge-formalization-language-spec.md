# 知識資産化の表示用語仕様

## INV-001: 内部契約を維持する

既存の `promotion` 系status、DB列、API pathは変更しない。

## INV-002: 承認と登録完了を分ける

Memory Candidateのapprove操作は、正式登録を許可する判断として表示する。成功メッセージは、正本への登録処理が別工程であることを明示する。

## INV-003: 保存先ごとに操作名を変える

- Skill候補: `再利用できる手順にする`
- legacy Wiki候補: 書き込み廃止済みのため、正本の分類が必要であることを表示する
- reject: `今回は見送る`
- 関連候補: 保存先と操作が同じ候補だけ具体的な操作名で一括処理し、分類待ちや異なる保存先を混ぜない

## INV-004: CLIと文書でも具体語を使う

候補一覧、manifest、適用・見送り結果では、利用者が遷移結果を判断できる日本語を表示する。frontmatterの機械可読フィールドは変更しない。

## テスト

- `tests/ui/modals/learning-candidate-modal.test.js`
- `tests/unit/learning-cli.test.js`
- `tests/domain/inbox/inbox-service.test.js`
- `tests/ui/views/mana-chat-view.test.js`

## Traceability

- AC-001: 内部契約の維持を `tests/server/services/learning-service.test.js` と `tests/server/routes/learning.test.js` で確認する。
- AC-002: 保存先別の具体的な操作名を `tests/domain/inbox/inbox-service.test.js` と `tests/ui/modals/learning-candidate-modal.test.js` で確認する。
- AC-003: 承認と正本登録の分離を `tests/ui/modals/learning-candidate-modal.test.js` と `tests/ui/views/mana-chat-view.test.js` で確認する。
- AC-004: 正本境界を `docs/architecture/story-knowledge-formalization-language.md` と文書トレーサビリティ検査で確認する。
- AC-005: 画面とCLIの具体語を `tests/ui/modals/learning-candidate-modal.test.js` と `tests/unit/learning-cli.test.js` で確認する。
- AC-006: 一括操作の保存先境界を `tests/ui/modals/learning-candidate-modal.test.js` で確認する。
- AC-007: legacy Wikiの分類待ちを `tests/ui/modals/learning-candidate-modal.test.js` と `tests/unit/learning-cli.test.js` で確認する。
