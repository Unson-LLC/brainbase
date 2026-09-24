---
story_id: story-company-os-graph-revision-read-v1
title: 判断からGraph entityとedgeの版付き正本を現行権限で読み出せる
status: implemented
created_at: 2026-09-24
implementation_started: true
owner_repository: brainbase
depends_on: ["story-company-os-problem-snapshot-v1", "story-company-os-ontology-v1"]
external_dependencies: []
---

# 判断からGraph entityとedgeの版付き正本を現行権限で読み出せる

## 利用者成果

判断問題が参照するGraphのentityまたはedgeについて、指定した版とダイジェストに一致する内容だけを、現在のACLとtenant/project scopeを確認したうえで判断へ渡せる。過去の内容を現在の権限で読めない場合や、存在・整合性・権限を確認できない場合は、成功として扱わない。

## 対象

- entity/edgeを対象にした、`id`・正の`revision`・`sha256`ダイジェスト・scopeの参照契約を追加する。
- Immutable payloadのダイジェストを再計算し、readerが返したidentity、payload、ダイジェストの不一致を閉じる。
- readerが返す現在のACLとscopeを毎回確認し、scope外または現在のACLで読めない版を拒否する。
- `JudgmentProblemReferenceProvider.resolveOther`へ渡せるadapterを提供する。
- missingは`missing`、unauthorizedは`unauthorized`、corrupt・例外・契約違反は`unresolved`へ写像する。

## 受入条件

- [x] entityとedgeの解決で、readerへphase、principal、要求scopeを渡し、指定したrevisionとdigestをそのまま確認できる。
- [x] identityまたはpayloadの不一致、digestの不一致、壊れたACL/scope、壊れたedge/entity形状を解決済みとして返さない。
- [x] 現行ACLの失効とtenant/project scopeの不一致を、過去版であっても`unauthorized`として返す。
- [x] readerのmissing/unauthorized/corruptと例外を、判断snapshotの参照結果へ安全に写像できる。
- [x] OSS側ではDB履歴やtenant membershipを生成せず、hostが実装するreader境界へ委譲する。

## 検証と完了

`npm run build` と `npx vitest run tests/graph-revision-reader.test.ts` で、entity/edge、resolveOther adapter、ダイジェスト不一致、ACL/scope失効、reader失敗の経路を検証する。
