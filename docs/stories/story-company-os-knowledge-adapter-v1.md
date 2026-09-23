---
story_id: story-company-os-knowledge-adapter-v1
title: 既存の知識候補と承認から採用判断の条件を辿れる
status: in_progress
created_at: 2026-09-23
implementation_started: true
owner_repository: brainbase
depends_on: ["story-company-os-learning-adoption-v1", "story-company-os-decision-adapter-v1"]
external_dependencies: [{"story_id": "story-canonical-runtime-ownership", "source_repo": "brainbase", "relationship": "requires_owned_api_surface", "availability": "common_port_provided_owner_fixtures_external"}]
---

# 既存の知識候補と承認から採用判断の条件を辿れる

## 利用者成果

知識の採用者として、候補の元証拠と採用時の目的・制約・権限を確認したい。

## 所有と対象

- 登録・実装repo: `Unson-LLC/brainbase`
- 対象: Knowledge／Graph maintenance adapter。旧入口の互換契約を対象とし、OSSに提供済みとは仮定しない

共通契約・正本保存・単独所有者で動く共通UIを所有する。組織のメンバー・役割・承認規則は組織版providerで実装し、本Storyではその結果を受け取るportと単独所有者の検証を扱う。外部サービスや社内runtimeを必須にしない。

## 既存実装との差分

実装開始時に既存APIの提供版と責務を確認する。既存Storyの登録や本文状態だけで提供済みと扱わない。列挙する旧API／型がOSSに存在するとは仮定しない。canonical-runtime-ownershipのTask契約は提供済みだが、必要なadapter面は不足しているため、所有portの定義と提供範囲を確定してから着手する。旧社内runtimeをOSSから直接呼ばず、互換契約の範囲だけを移す。廃止経路は復活させない。

- `brainbase / story-canonical-runtime-ownership`：requires_owned_api_surface（OSS共通portは提供済み。各owner側の適合fixture／readbackは所有repoで検証する）

### 現時点の提供状況（2026-09-23確認）

- **共通port**: `src/knowledge-adapter.ts` が会社／組織側のKnowledge Event、feedback、candidate昇格、Graph maintenance、Human Gate、MeetingKnowledgeEventBridgeの結果を受け取る `LegacyKnowledgeRecordPort`／`KnowledgeAdoptionReadPort` を定義する。各旧入口の実装所有者は組織側に残し、旧入口の適合fixtureでquarantine・ACL・元証拠・権限拒否の形を固定する。
- **採用locator**: `src/company-os-learning-adoption.ts` が採用record全体のcanonical digestを使う `LearningAdoptionLocator` と、現在ACL・候補・検証・採用targetのexact readbackを行う `readAdoptionByLocator` を提供する。採用record内部のcatalog versionやtarget revisionをlocatorへ流用しない。
- **保存と境界**: `src/personal-knowledge.ts` のevent／context／ACL境界と `src/judgment-value-proof.ts` のfeedback／proof型は共通契約の部品として参照する。個人Knowledgeを会社Graphの正本へ拡張せず、OSS adapterは本文・tenant data・secretを保存しない。
- **着手条件（履歴）**: OSS所有のKnowledge adapter portを定義し、quarantine・ACL・Human Gate・元証拠・権限拒否を旧入口fixtureで固定する。組織承認providerやManaの外部入口はこのStoryの正本にせず、結果をportで受けられることを確認してから実装を開始する。

### 実装着手後の提供範囲（2026-09-23）

- `src/knowledge-adapter.ts` に、既存host recordを本文ごと移さず、exact source locator・provenance・判断条件・readonly adoption locatorだけを接続する `LegacyKnowledgeRecordPort`／`KnowledgeAdoptionReadPort`／`KnowledgeConditionReferenceAdapter` を追加した。採用locatorは`id/schema/contentDigest`のv2契約とし、旧v1の`id/revision/digest`はlegacyとして保持して再解釈しない。
- `GraphKnowledgeConditionAdapter` は `evidence/knowledge-condition-adapter.json` をsidecarとして使い、provider readをSSOT lock外、canonical aggregateとsidecarのCAS・staged readback・transaction publicationをlock内で行う。
- `tests/knowledge-adapter.test.ts` は実際のpersonal SSOTを使い、quarantine、ACL拒否／不明、provider障害、not-found、exact revision/digest、provenance・adoption readback、idempotency、conflict、canonical CASを固定する。旧入口は本番runtimeを直接呼ばず、名前付きport適合fixtureで互換境界を検証する。
- `tests/company-os-learning-adoption.test.ts` は実際のlearning storeとFoundation storeを使い、採用locatorの正本digest、locator readback、digest不一致、current ACL変更による拒否を固定する。
- 旧会社HTTP route、組織の承認provider、MeetingKnowledgeEventBridgeの本番runtime組み込みはこのOSS Storyの完了条件に含めない。組織側owner portの適合とreadbackは、各所有repoのfixture／CIで検証し、OSSはその結果を受け取る共通契約と切替／切戻し境界を提供する。

## 設計参照

- [全体設計](https://github.com/Unson-LLC/brainbase-project/blob/main/docs/architecture/company-os-design.md)
- [継続運用契約](https://github.com/Unson-LLC/brainbase-project/blob/main/docs/architecture/company-os-operating-contract.md)
- [repo横断依存・実装順](https://github.com/Unson-LLC/brainbase-project/blob/main/docs/architecture/company-os-implementation-map.md)

今回の設計改訂はローカル成果物。これらのURLは所有先を示し、公開・merge済みを意味しない。全体方針をStoryへ複製しない。

## 依存するストーリー

- `brainbase / story-company-os-learning-adoption-v1`
- `brainbase / story-company-os-decision-adapter-v1`

依存は提供契約の先行条件。目的への貢献・期限とは異なる。外部依存を含め、着手時に採用版と提供範囲を最小Specで固定する。

## 受入条件

- [ ] AC-01: Knowledge Event／feedback／candidate昇格とGraph maintenanceの各旧入口を、名前付きport適合fixtureで共通判断参照へ接続する。各record本文の所有・承認はhost側に残す。
- [ ] AC-02: quarantine・ACL・Human Gateを維持し、候補抽出や承認自体を真実の証明にしない。
- [ ] AC-03: MeetingKnowledgeEventBridgeの適合portが返す元証拠を保持し、条件未記録の旧イベントを補作しない。
- [ ] AC-04: 各対象入口の互換性・参照readback・current ACL／権限拒否をfixtureと実storeで検証し、port binding単位で切替／切戻しできる。外部サービスや社内runtimeの本番接続は完了条件にしない。

## 対象外

既存承認機構の置換、全候補の自動採用。 社内配備・秘密・顧客データの移管、廃止経路の復活。

## 検証と完了

受入条件と反例を最小Specで固定する。変更した保存内容は同じID・版で読戻す。純粋な契約はfixture、永続化は実際のstore、UIは実操作で確認する。共通機能はOSS単独、組織境界は組織adapter、外部作用はManaで検証する。

現在は実装着手済み。OSSの共通port、採用locator、personal adapterの最小実装・実store／fixture検証を進めている。旧入口のowner側adapter適合、組織境界のfixture／CI、外部配備、PR/CIは所有repoの検証範囲であり、このOSS commitだけを本番接続やStory全体の完了証拠にしない。
