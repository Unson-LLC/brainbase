---
story_id: story-company-os-durable-wait-http-v1
title: ManaがOSSの永続待機をcanonical HTTP経由で参照できる
status: active
created_at: 2026-09-23
implementation_started: true
owner_repository: brainbase
depends_on: ["story-company-os-durable-waits-v1"]
external_dependencies:
  - story_id: story-company-os-mana-resume-v1
    source_repo: mana-runtime
    relationship: consumes_canonical_http_contract
    availability: consumer_adapter_implemented; cross_repo_runtime_readback_separate
---

# ManaがOSSの永続待機をcanonical HTTP経由で参照できる

## 利用者成果

ManaのCloudflare Workerが、Brainbaseの永続待機をNode依存のstore移植なしで読み書きし、イベント・期限・再起動を同じ待機責任へ戻せる。HTTP hostは認証済みのtenant／principal／scopeをOSSのhandlerへ渡し、待機台帳・現在ACL・Problem snapshotの正本をBrainbase側で保持する。

## 所有と対象

- 登録・実装repo: `Unson-LLC/brainbase`
- 対象: `@unson/brainbase-mcp/durable-wait-http` の合成可能なNode HTTP handlerと、その実store境界テスト

OSSはcanonicalなpath、envelope、入力検証、trusted contextへの主体束縛、既存 `DurableWaitStore` への委譲を所有する。認証・tenant／principal／scope解決、現在ACL／Problem snapshot provider、serverのlisten、組織固有の承認はHTTP hostが所有する。Manaは別repoでWorker-safeなfetch client／coordinatorとevent・timer・restartの統合を所有し、OSSのNode/fs storeや待機Ledgerを複製しない。

## 受入条件

- [x] AC-01: `durable-wait-http.v1` のhandlerを公開し、既定の `/api/v1/durable-waits` 配下でcreate・read・claim・resume・handoff・premise-changed・effect-unknownを既存storeへ委譲する。未知pathは委譲可能な `false`、対象pathの未対応methodはHTTPエラーとする。
- [x] AC-02: hostが注入したtenant／principal／scopeを全操作へ束縛し、bodyの主体・owner scope不一致、権限表現、未検証のmutation originをfail closedする。current ACLとProblem snapshotの検証はstore/provider境界を通り、handlerがbodyから権限を発行しない。
- [x] AC-03: 実Node HTTP server、実 `DurableWaitStore`、実sidecarを使い、create→read→claim→重複claim→resume→再送readを検証する。effect unknown後の再開拒否、scope／ACL拒否、body identityとmutation origin拒否も確認する。
- [x] AC-04: `createDurableWaitHttpHost` が認証後のcontext resolverと実 `DurableWaitStore` を合成し、Node HTTP経由で別repoのMana clientから readback できる境界を公開する。repo横断のreadback実行記録はMana Story18側へ分離し、OSS側テストの件数やStory13の26件の計数へ混ぜない。

## 対象外

本番の認証・tenant解決・RACI、組織固有のProblem snapshot provider、外部作用の実行は対象外。`createDurableWaitHttpHost` は認証済みcontextを解決してcanonical handlerをlisten可能なNode hostへ合成するが、組織固有の認証providerや本番deployを提供しない。Manaのqueue／scheduled runtime入口はmana-runtime側で検証する。

## 依存と境界

- `story-company-os-durable-waits-v1` が提供する永続store、current ACL、Problem snapshot検証を利用する。
- `story-company-os-mana-resume-v1` はconsumer側の外部依存であり、Manaの実装・queue／scheduled接続をbrainbaseが所有することを意味しない。
- OSSはHTTP handlerと、listenerを呼出元が所有できる最小host合成関数を公開するが、認証情報やtenant解決を保存しない。host resolverはtrusted contextを認証後に生成し、mutation originを検証してからhandlerへ渡す。resolver失敗は401へ閉じる。

## 検証と完了

対象Specの契約テストと `npm run build` を実行する。実store readbackは `createDurableWaitHttpHost` が返すNode HTTP serverと実sidecarを用いる。Manaとの接続は別repoのclient fixture／runtime readbackで確認し、OSSのStory13に含まれる既存26件のテスト計数を変更しない。CI・レビュー・PR・mergeは親の通常GitHub手続きで行う。
