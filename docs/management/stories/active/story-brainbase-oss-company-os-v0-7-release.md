---
story_id: story-brainbase-oss-company-os-v0-7-release
title: Brainbase OSS Company OS v0.7.0を配布候補として固定する
status: active
category: maintenance
period: 2026Q3
spec: docs/specs/story-brainbase-oss-company-os-v0-7-release.md
canonical_story_path: docs/management/stories/active/story-brainbase-oss-company-os-v0-7-release.md
created_at: 2026-09-24
updated_at: 2026-09-24
pr_scope_strategy: atomic_single_pr
pr_scope_reason: "Company OSの公開契約を0.7.0へ束ね、既存0.6.0のdeep import互換とfresh tarballの検証条件を同じ配布候補へ固定する。"
---

# Brainbase OSS Company OS v0.7.0を配布候補として固定する

## 利用者成果

Brainbase OSSの利用者として、目的・世界モデル・制約・判断問題・評価・学習採用を含むCompany OS共通契約を、`@unson/brainbase-mcp@0.7.0`の一つの配布候補から利用したい。既存の0.6.0公開subpathはそのまま利用でき、新しい契約は公開manifestとtarballに含まれることを確認できる状態にする。

## 受け入れ基準

- [x] `package.json`と`package-lock.json`のroot package versionが`0.7.0`で一致する。
- [x] 公開済み`@unson/brainbase-mcp@0.6.0`との比較で、既存exportの削除・参照先変更・package名変更がない。Company OS実装の公開subpathは追加として扱う。
- [x] build後のCompany OS公開subpathが対応する`dist/*.js`と`dist/*.d.ts`を解決でき、UI・contract artifactを含むtarballを作成できる。
- [x] 0.7.0のrelease対象、互換性判断、検証コマンド、未確認のnpm公開状態がStory/Specから追跡できる。
- [x] 公開registry、GitHub PR、merge、GitHub Release、Organization/Manaの本番組込みをこの候補作成の完了とは扱わない。

## 完了証拠

同一HEADで、manifest整合、`npm run build`、Company OSのaffected tests、consumer smoke、docs check、およびdry-run tarballの検証結果を記録する。npm registryの0.7.0 metadata、dist-tag、GitHub Releaseは配布後の別readbackで確認する。
