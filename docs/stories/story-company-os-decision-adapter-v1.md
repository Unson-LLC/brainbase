---
story_id: story-company-os-decision-adapter-v1
title: 既存のDecision作成から今回の判断条件を辿れる
status: done
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
- 対象: InfoSSOT Decision／AI decision adapter。旧入口の互換契約をOSS所有のadapter境界として提供する

共通契約・正本保存・単独所有者で動く共通UIを所有する。組織のメンバー・役割・承認規則は組織版providerで実装し、本Storyではその結果を受け取るportと単独所有者の検証を扱う。外部サービスや社内runtimeを必須にしない。

## 既存実装との差分

既存APIの提供版と責務を確認し、canonical-runtime-ownershipのTask契約を基礎にOSS所有のadapter portと提供範囲を確定した。旧社内runtimeをOSSから直接呼ばず、互換契約の範囲だけを移している。廃止経路は復活させない。

- `brainbase / story-canonical-runtime-ownership`：requires_owned_api_surface（Task契約は提供済み。外部依存側にadapter面はないため、本StoryでOSS所有面を実装）

### 提供状況（2026-09-23確認）

- **OSS側実装済み**: `src/decision-adapter.ts` が `DecisionAdapterPort`／`GraphDecisionAdapterStore` と旧レスポンス識別子を含む互換契約を提供する。既存のDecision Graph entityと`decisions.jsonl`を正本として保持し、Problem snapshot・方法版・Objective版は版付きsidecar参照として同じDecision IDへ接続する。
- **提供**: `src/canonical-task-principal.ts`・`src/canonical-task-contract.ts`・`src/canonical-task-service.ts`、`src/judgment-dag.ts`・`src/judgment-value-proof.ts`を基礎に、AC-01の `/api/info/decisions`・`/api/info/ai/decision-log` と、DecisionからJudgmentProblem・DAG版・Objective版へ辿るOSS所有adapterを提供する。
- **再利用**: `src/judgment-dag.ts` のDAG／参照版／実行成果物と `src/judgment-value-proof.ts` の証明・feedback型を共通契約の基礎にする。組織BFFや旧社内runtimeをOSSの正本として直接参照しない。
- **条件と境界**: 新規書込みは必須条件を検証し、注入されたtrusted condition validatorで現在の存在・ACLを確認できる。Objectiveや権限を推測せず、組織のHTTP route・RACI・旧社内runtimeはこのStoryで実装しない。
- **lockと切戻し**: trusted providerのread・認可はSSOT lock外で行い、canonical aggregateとsidecarをcommit直前にCAS検証する。lock内で外部awaitを行わず、検証中の同時変更は新しい証跡を残さず拒否する。旧条件未記録Decisionは`unrecorded`として読める。AI decision logは既存Decisionにsidecarで付加し、別のGraph正本や`ai_decision` entityを作らない。commit後のcurrent ACL/read拒否は保存済み記録を巻き戻さない。
- **境界**: `story-canonical-runtime-ownership`のTask契約は外部依存として参照するが、既存組織routeの接続と本番組込みはこのStoryの完了証跡に含めない。

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

AC-01〜04は、`npm run build` と `npx vitest run tests/decision-adapter.test.ts`（14 tests）で、必須条件の拒否、旧レコードの条件未記録読取、Graph SSOTの同一ID、AI logのsidecar保存、実際のGraphFoundationRevisionStoreを読むtrusted providerのlock外実行、検証中のcanonical/sidecar同時変更のCAS拒否、trusted validator拒否、commit後のcurrent read拒否を保存済み記録へ波及させないこと、所有者認証、原子的切戻し、fixture互換を確認した。さらにPR #536のレビュー通過、merge `bdf02f848d3c78fdfbf50602c75c3b9efadc382e`、CI [35851699844](https://github.com/Unson-LLC/brainbase/actions/runs/35851699844) successで確認した。Decision adapterはOSS所有の公開境界として完了し、組織側の既存route接続と本番組込みは別途検証対象である。VibeProのactiveは登録状態を示す既存値として維持する。
