# Spec: 顧客提供前のリポジトリ分類

## 正本

分類の本文正本は `docs/policies/repository-classification.md` とする。`AGENTS.md` と `CLAUDE.md` は本文を複製せず、判定要約と正本へのリンクだけを持つ。

## 検知契約

`npm run check:repository-classification` は、Git管理対象を読み取り、次を満たさない場合に非0で終了する。

1. 分類方針が存在する。
2. `AGENTS.md` と `CLAUDE.md` が一致し、分類方針を参照する。
3. 新しい正本として復活させない禁止ルート `shared/`、`_codex/`、`settings/nocodb/`、`common/frameworks/` が追跡されていない。
4. 分類方針に3つの配布境界が明記される。

`.git/` や未追跡ファイルは判定対象にしない。既存の例示用 `examples/codex/` は `_codex/` そのものではないため禁止しない。

## 検証

- 分類関数の単体テスト
- 実repoに対するチェック実行
- `AGENTS.md` / `CLAUDE.md` の一致確認
- 変更後Graphifyの影響確認。未一致の場合は不明のまま記録する。
