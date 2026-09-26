---
story_id: story-foundation-draft-write-v1
title: Foundationの草案を認証済みGraph更新境界へ安全に渡せる
status: in_progress
created_at: 2026-09-26
updated_at: 2026-09-26
implementation_started: true
owner_repository: brainbase
depends_on: ["story-company-os-ontology-v1", "story-judgment-foundation-coherence-v1"]
external_dependencies: []
---

# Foundationの草案を認証済みGraph更新境界へ安全に渡せる

## 利用者成果

Graph writerの実装者として、Objective・Variable・Model・Constraintの草案を、認証済みの主体とプロジェクトの範囲内で、改訂履歴を壊さずに保存したい。

## 受入条件

- [x] AC-01: 草案書込みは登録済みの4 Foundation型だけを受け付け、`adoptionState=draft`、`storage=candidate`、`authorizedUses=[draft]`、非空のprovenanceを必須にする。
- [x] AC-02: payloadのid・type・revision・project scopeがGraph rowおよび信頼済みcontextと一致することを確認する。欠落・改ざん・別プロジェクトへの移動はfail closedにする。
- [x] AC-03: 新規はrevision 1かつ所有者が認証済み主体、更新は現在定義から連続する次revisionを必須にする。旧版の保持はcanonical writerのPostgreSQL row version/history trigger境界で担保し、純粋validatorへGraph aggregate versionを要求しない。Objective・Modelの不完全な草案はdraft境界では保存可能にする。
- [x] AC-04: 更新は現在ACLのownerまたはwriterだけに許可し、失効済み・無権限主体を拒否する。ownerIdの変更やACLを使った所有権移転は拒否する。
- [x] AC-05: 成功結果はcanonical writerへ渡せる正規化済み草案だけを返し、I/O・Graph mutation・テナント推測を行わない。

## 対象外

認証主体の解決、Graph rowの取得・ロック・RLS、永続化、Ontologyの公開、draftを判断用途へ昇格する処理。

## 検証

純粋なvalidatorのunit testで、4型の正常系、draft限定、id/type/revision/scopeの不一致、current ACL、owner transfer、次revision、不完全Objective/Modelを確認する。TypeScript buildも実行する。

## 検証結果

Node 22で影響する22テストとTypeScript buildが通過。レビューで見つかった不正ACLの例外とproject scope拡張を修正済み。Host永続化と本番公開は別Storyで検証する。
