---
story_id: story-company-os-decision-adapter-v1
title: 既存のDecision作成から今回の判断条件を辿れる
status: verified
created_at: 2026-09-23
implementation_started: true
owner_repository: brainbase
depends_on: ["story-company-os-problem-snapshot-v1"]
external_dependencies: [{"story_id": "story-canonical-runtime-ownership", "source_repo": "brainbase", "relationship": "requires_owned_api_surface", "availability": "provided_but_required_adapter_surface_missing"}]
---

# 既存のDecision作成から今回の判断条件を辿れる

## 利用者成果

既存APIの利用者として、互換性を保ったままDecisionが参照した条件を確認したい。

## 所有と対象

- 登録・実装repo: `Unson-LLC/brainbase`
- 対象: InfoSSOT Decision／AI decision adapter。旧入口の互換契約を対象とし、OSSに提供済みとは仮定しない

共通契約・正本保存・単独所有者で動く共通UIを所有する。組織のメンバー・役割・承認規則は組織版providerで実装し、本Storyではその結果を受け取るportと単独所有者の検証を扱う。外部サービスや社内runtimeを必須にしない。

## 既存実装との差分

実装開始時に既存APIの提供版と責務を確認する。既存Storyの登録や本文状態だけで提供済みと扱わない。列挙する旧API／型がOSSに存在するとは仮定しない。canonical-runtime-ownershipのTask契約は提供済みだが、必要なadapter面は不足しているため、所有portの定義と提供範囲を確定してから着手する。旧社内runtimeをOSSから直接呼ばず、互換契約の範囲だけを移す。廃止経路は復活させない。

- `brainbase / story-canonical-runtime-ownership`：requires_owned_api_surface（Task契約は提供済み、必要adapter面が不足）

### 現時点の提供状況（2026-09-23確認）

- **OSS側実装済み**: `src/decision-adapter.ts` が `DecisionAdapterPort`／`GraphDecisionAdapterStore` と旧レスポンス識別子を含む互換契約を提供する。既存のDecision Graph entityと`decisions.jsonl`を正本として保持し、Problem snapshot・方法版・Objective版は版付きsidecar参照として同じDecision IDへ接続する。
- **条件と境界**: 新規書込みは必須条件を検証し、注入されたtrusted condition validatorで現在の存在・ACLを確認できる。Objectiveや権限を推測せず、組織のHTTP route・RACI・旧社内runtimeはこのStoryで実装しない。
- **lockと切戻し**: trusted providerのread・認可はSSOT lock外で行い、canonical aggregateとsidecarをcommit直前にCAS検証する。lock内で外部awaitを行わず、検証中の同時変更は新しい証跡を残さず拒否する。旧条件未記録Decisionは`unrecorded`として読める。AI decision logは既存Decisionにsidecarで付加し、別のGraph正本や`ai_decision` entityを作らない。commit後のcurrent ACL/read拒否は保存済み記録を巻き戻さない。

## 設計参照

- [全体設計](https://github.com/Unson-LLC/brainbase-project/blob/main/docs/architecture/company-os-design.md)
- [継続運用契約](https://github.com/Unson-LLC/brainbase-project/blob/main/docs/architecture/company-os-operating-contract.md)
- [repo横断依存・実装順](https://github.com/Unson-LLC/brainbase-project/blob/main/docs/architecture/company-os-implementation-map.md)

今回の設計改訂はローカル成果物。これらのURLは所有先を示し、公開・merge済みを意味しない。全体方針をStoryへ複製しない。

## 依存するストーリー

- `brainbase / story-company-os-problem-snapshot-v1`

依存は提供契約の先行条件。目的への貢献・期限とは異なる。外部依存を含め、着手時に採用版と提供範囲を最小Specで固定する。

## 受入条件

- [x] AC-01: OSSの`DecisionAdapterPort`／`GraphDecisionAdapterStore`が、旧`/api/info/decisions`・`/api/info/ai/decision-log`の応答識別子とProblem・方法版参照の契約を提供する。組織HTTP routeへの実組込みは別repo側の残課題である。
- [x] AC-02: 新経路は必須条件を検証し、旧レコードは条件未記録として読む。Objective・権限を推測補完しない。
- [x] AC-03: 既存レスポンスとID・Graphの正本を維持し、二重書込みの別正本を作らない。
- [x] AC-04: 匿名化した旧応答形fixtureと実storeで互換性・切戻しを検証し、新しい証跡を削除せず旧読取を維持する。

## 対象外

承認・学習・receipt系の同時移行。 社内配備・秘密・顧客データの移管、廃止経路の復活。

## 検証と完了

受入条件と反例を最小Specで固定する。変更した保存内容は同じID・版で読戻す。純粋な契約はfixture、永続化は実際のstore、UIは実操作で確認する。共通機能はOSS単独、組織境界は組織adapter、外部作用はManaで検証する。

OSS側の実装とローカル検証は完了した。`npm run build` と `npx vitest run tests/decision-adapter.test.ts`（14 tests）が通過し、必須条件の拒否、旧レコードの条件未記録読取、Graph SSOTの同一ID、AI logのsidecar保存、実際のGraphFoundationRevisionStoreを読むtrusted providerのlock外実行、検証中のcanonical/sidecar同時変更のCAS拒否、trusted validator拒否、commit後のcurrent read拒否を保存済み記録へ波及させないこと、所有者認証、原子的切戻し、fixture互換を確認した。組織repoの既存HTTP routeへの実組込み、PR、CI、mergeはこのworktreeでは未完了であり、Story完了とは別に扱う。
