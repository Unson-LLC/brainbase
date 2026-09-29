---
story_id: story-foundation-graph-objective-read
title: 組織の目的をGraph正本から読み取れる
status: in_progress
---

# 組織の目的をGraph正本から読み取れる

組織の利用者として、「目的と現状」で選んだプロジェクトの目的を正本から読み、評価基準と版を確認したい。

## 設計参照

Brainbase Atlas: `Unson-LLC/brainbase-project@d17bb76` の `docs/architecture/diagrams/atlas/scopes/org.mjs`（bff-cos）と `docs/architecture/oss-to-organization-handover-contract.md` §4。組織BFFは保存層を持たず、認証済みの本人・組織・project scopeで正本APIを利用する。本人の引き継ぎ束は別のowner-private領域であり、このAPIに混ぜない。

## 問題

Graph Foundation handlerは公開契約のrouteだけを登録しており、UIが使用する `/api/foundation/objectives` は `404 not_found: Route not found` になる。取得失敗はデータ不存在の証拠ではない。

## 受入条件

- AC-1: 認証済みで許可されたproject scopeの目的一覧を、Graph正本から既存UI契約のrecordsとして読み取れる。
- AC-2: 同じ目的の詳細と版を読み、現在の権限・scopeと既存Foundationの定義検証を維持する。
- AC-3: 他project・他organization・権限外の目的やowner-privateの束を返さない。requestのauthority上書きを拒否する。
- AC-4: DB・migration・不正payloadなどの失敗を空の成功に変換しない。正しく読めた空集合のみemptyにする。
- AC-5: 既存の公開Foundation contractと参照検証は維持する。未実装の変更操作を成功扱いせず、書込権限を広げない。

## 検証

Graph境界のHTTPテストで一覧・詳細・版、空集合、scope拒否、DB失敗、不正payloadを確認する。永続化層は既存のGraph schema/RLSを使う。実稼働への反映と認証付きAPI・画面readbackは別途確認し、ローカル検証だけで本番解消とはしない。
