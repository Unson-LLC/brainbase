---
story_id: story-company-os-execution-authority-http-v1
title: 信頼済みの組織コンテキストから実行開始と意図の読出しを安全に呼び出す
status: in_progress
created_at: 2026-09-23
implementation_started: true
owner_repository: brainbase
depends_on: ["story-company-os-execution-authority-v1"]
external_dependencies: []
---

# 信頼済みの組織コンテキストから実行開始と意図の読出しを安全に呼び出す

## 利用者成果

組織側のHTTPホストとして、認証・テナント解決・変更元検証を済ませた要求だけを、同じテナントの実行権限サービスへ渡したい。実行開始は現在の権限・承認・制約・予約の再検証と既存の冪等性を保ち、実行意図の読出しは現在のread権限を通したい。

## 所有と対象

- 登録・実装repo: `Unson-LLC/brainbase`
- 対象: OSSが提供する合成可能なNode HTTP handler

認証、tenant／principal／scopeの解決、RACI、組織固有の承認規則、外部作用はこのStoryの所有範囲外。HTTP hostが生成したtrusted contextとtenant-scoped service factoryを境界にする。

## 受入条件

- [ ] AC-01: `POST /execution-authority/start` がtrusted contextへ主体を束縛し、既存 `ExecutionAuthorityService.start` の現在検証・永続化・予約線形化・作用port境界を迂回せず呼び出す。
- [ ] AC-02: `GET /execution-authority/intents/{operationId}` が同じtrusted contextの `readIntent` を呼び出し、現在read ACLの拒否やtenant／scope越境を成功へ変換しない。
- [ ] AC-03: bodyの主体不一致、未契約の権限表現、malformed JSON、未検証の変更元はservice factoryと副作用の前に拒否する。要求bodyからtenantや権限を推測・昇格しない。
- [ ] AC-04: 実Node HTTP server、実 `ExecutionAuthorityService`、実sidecarを使い、二つのtenantの分離、現在permissionの拒否、同じoperationIdの再送、readbackを検証できる。

## 対象外

認証・CSRF・RACI・capacityの本番provider、organization BFFのroute登録、Manaの外部作用、`start_external`の公開。

## 検証と完了

対象Specの契約テストと `npm run build` を実行する。組織providerや本番接続はfixtureで代用したことを提供済みとは扱わず、別Storyの検証境界として残す。
