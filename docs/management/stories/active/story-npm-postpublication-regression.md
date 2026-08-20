---
story_id: story-npm-postpublication-regression
title: 公開後も通常回帰を実行できるようにする
status: active
category: maintenance
architecture: docs/architecture/story-npm-postpublication-regression.md
spec: docs/specs/npm-postpublication-regression.md
---

# 公開後も通常回帰を実行できるようにする

## 利用者価値

npmパッケージの保守担当者として、一般的なローカルCLIで同じversionの公開後も通常の回帰テストを実行したい。公開前にだけ成立する「対象versionが存在しない」という検査が通常回帰を失敗させず、将来の変更を継続して検証できるようにするためである。

## 受け入れ基準

- [x] `npm test` は公開前専用テストを除外し、公開済みversionでも通常回帰を実行できる。
- [x] `npm run test:integration:release-evidence` は公開前専用テストを明示的に含む。
- [x] 公開前専用スクリプトのregistry不存在、clean HEAD、tarball integrity検査は変更しない。
- [x] 受け入れテストが通常回帰と公開前専用コマンドの分離を固定する。

## 対象外

- npmへの公開、dist-tag、GitHub Releaseの変更
- パッケージversionの変更
- 公開前検査の緩和または削除

## 完了証拠

現在HEADで通常回帰、受け入れテスト、build、型検査が成功し、公開前専用テストの `rejects a version already present in the registry` と `rejects a dirty HEAD before collecting release evidence` が各境界を安全に拒否することを確認する。
