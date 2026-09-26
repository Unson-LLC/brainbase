---
story_id: story-company-os-philosophy-revision-read-v1
title: 判断に使う哲学の正本版を現行権限と適用範囲つきで読み出せる
status: implemented
created_at: 2026-09-26
implementation_started: true
owner_repository: brainbase
depends_on: ["story-company-os-problem-snapshot-v1"]
external_dependencies: []
---

# 判断に使う哲学の正本版を現行権限と適用範囲つきで読み出せる

## 利用者成果

判断問題が参照する哲学について、既存の正本が返すID・版・ダイジェスト・適用範囲と期間を固定して解決できる。過去版を読む場合も現在のACLとscopeを確認し、正本の内容や適用条件が改ざんされていれば判断へ渡さない。

## 対象

- 哲学をConstraintやFoundation型へコピーせず、ホストが所有する正本のrevision reader portを定義する。
- 正本のidentity、opaqueな哲学payload、適用scope・期間から安定したSHA-256 digestを計算する。
- readerが返す現在のACLとscopeを毎回検証し、historical readでも失効した権限やscope外の読み出しを拒否する。
- 既存のJudgmentProblemReferenceProviderへ委譲できるresolverを提供し、missing・unauthorized・corruptを安全に判断参照結果へ写像する。

## 受入条件

- [x] 正本のID・正のrevision・digest・scope・適用期間が一致したときだけ哲学revisionを解決できる。
- [x] payloadまたは適用条件から再計算したdigestが不一致、またはreaderのidentity・ACL・scope・期間metadataが壊れている場合は解決しない。save/readでは適用scope・期間もreferenceと照合する。
- [x] historical readでもreaderの現在ACLと要求scopeを確認し、読めない過去版を成功として扱わない。過去の適用可否は再判定せず、固定されたdigestを確認する。
- [x] readerのmissing/unauthorized/corrupt、例外、契約違反を、存在・権限・整合性の意味を保ってJudgmentProblemのstatusへ写像する。
- [x] OSS側は哲学正本の保存、版生成、tenant membershipを持たず、既存の正本を実装するhost readerへ委譲する。

## 対象外

- 哲学の正本データをFoundationへ複製することや、5番目のFoundation型を追加すること。
- Unson固有の認証、tenant membership、哲学の保存・承認UI。

## 検証と完了

`npx vitest run tests/philosophy-revision-reader.test.ts`（13 tests passed）で、解決成功、digest改ざん、適用範囲・期間不一致、現行ACL失効、reader失敗を検証した。`npm run build` も `JudgmentProblemReferenceKind` への `philosophy` 接続後に通過した。
