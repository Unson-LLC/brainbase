---
story_id: story-philosophy-catalog-legacy
title: 旧哲学データがあっても目的と現状を確認できる
status: active
created_at: 2026-10-06
implementation_started: true
owner_repository: brainbase
depends_on: ["story-company-os-philosophy-revision-read-v1"]
external_dependencies: []
---

# 旧哲学データがあっても目的と現状を確認できる

## 利用者成果

目的と現状のカタログを開いたとき、適用範囲を持たない旧哲学が残っていても、他の目的や判断に利用できる哲学の一覧を確認できる。判断に使う哲学は、適用範囲と期間が検証済みの版だけに限る。

## 受入条件

- [x] 適用範囲 (`judgmentApplicability`) を持たない旧哲学は、目的・現状カタログの判断可能な哲学一覧から除外され、同じプロジェクトの目的や有効な哲学の一覧を止めない。
- [x] `judgmentApplicability` が `null`、または構造・scope・期間のいずれか不正な哲学は、一覧から黙って除外せず `corrupt_catalog` として拒否する。
- [x] 個別の厳格な哲学読込は従来どおり適用範囲を要求し、旧payloadを判断可能な版として返さない。
- [x] 現行Graph行の可視性、ACL、選択プロジェクト、履歴ダイジェストの検証は変更せず、scope外や権限外の哲学を返さない。

## 対象外

- 旧哲学payloadへ架空の適用範囲や期間を補完すること。
- 旧データを正本へ移行・更新すること。
- 個別読込の厳格な検証を一覧用に緩めること。

## 検証

実DB互換のSQLテストで、適用範囲のない旧行が一覧から除外され、適用範囲を持つ行だけが返ることを確認する。nullまたは不正な明示metadata、個別読込の欠損payload、scope/ACL違反は既存のreaderテストで拒否されることを確認する。

## 検証結果

- reader単体とPGlite統合: 2ファイル22テスト成功。
- `npm run build` と `git diff --check`: 成功。
- 独立レビュー: 指摘なし。
- 本番反映後の画面復旧: 未確認。
