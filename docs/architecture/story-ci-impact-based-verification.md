# 変更対象に応じたCI検証とリリース証明を両立する

## Story

開発者として、変更した対象に必要な検証だけを受け取りたい。ドキュメント変更でパッケージ全体を再検証する待ち時間を増やさず、パッケージ変更では実際のテスト集合を完了させ、公開処理ではartifact・証明・公開後の状態を引き続き確認したい。

## 成果

- パッケージ関連PRは、Node 22の完全な`npm test`とbuild、Node 20の代表統合スイートで契約を確認する。
- ドキュメント関連PRは、公開契約、VitePress build、built HTML smokeに集中し、パッケージのbuild/testを重複実行しない。
- `develop`へのpushによる公開サイトdeployは、公開サイト入力またはworkflow自身の変更に限定し、既存の公開後readbackを保つ。
- npm公開とpublic-message promotionは、immutableな証明と人間のレビュー境界を保ち、自動mergeや未検証の公開を行わない。

## 境界

この変更はCIの責務分割だけを対象とする。秘密情報、公開権限、release artifactの検証境界、公開後のreadbackは変更しない。選択フレームワーク、retry、追加の重いgateは導入しない。
