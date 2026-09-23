---
story_id: story-company-os-knowledge-adapter-v1
title: 既存の知識候補と承認から採用判断の条件を辿れる
status: planned
created_at: 2026-09-23
implementation_started: false
owner_repository: brainbase
depends_on: ["story-company-os-learning-adoption-v1", "story-company-os-decision-adapter-v1"]
external_dependencies: [{"story_id": "story-canonical-runtime-ownership", "source_repo": "brainbase", "relationship": "requires_owned_api_surface", "availability": "provided_but_required_adapter_surface_missing"}]
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

- `brainbase / story-canonical-runtime-ownership`：requires_owned_api_surface（Task契約は提供済み、必要adapter面が不足）

### 現時点の提供状況（2026-09-23確認）

- **不足**: `src/personal-knowledge.ts` は個人所有のcontext／event／store／client契約であり、AC-01の会社共有Knowledge Event・feedback・candidate昇格・Graph maintenance承認adapterと、AC-03のMeetingKnowledgeEventBridge共有読戻し面は提供されていない。
- **再利用**: `src/personal-knowledge.ts` のevent／context／ACL境界と `src/judgment-value-proof.ts` のfeedback／proof型を共通契約の部品にする。個人Knowledgeを会社Graphの正本へ拡張しない。
- **着手前条件**: OSS所有のKnowledge adapter portを定義し、quarantine・ACL・Human Gate・元証拠・権限拒否を旧入口fixtureで固定する。組織承認providerやManaの外部入口はこのStoryの正本にせず、結果をportで受けられることを確認してから実装を開始する。

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

- [ ] AC-01: Knowledge Event／feedback／candidate昇格とGraph maintenanceの既存承認記録へ共通判断参照を接続する。
- [ ] AC-02: quarantine・ACL・Human Gateを維持し、候補抽出や承認自体を真実の証明にしない。
- [ ] AC-03: MeetingKnowledgeEventBridgeが持つ元証拠を保持し、条件未記録の旧イベントを補作しない。
- [ ] AC-04: 各対象入口の互換性・参照readback・権限拒否を検証し、経路単位で切替／切戻しできる。

## 対象外

既存承認機構の置換、全候補の自動採用。 社内配備・秘密・顧客データの移管、廃止経路の復活。

## 検証と完了

受入条件と反例を最小Specで固定する。変更した保存内容は同じID・版で読戻す。純粋な契約はfixture、永続化は実際のstore、UIは実操作で確認する。共通機能はOSS単独、組織境界は組織adapter、外部作用はManaで検証する。

現在は計画済み・未着手。VibeProのactiveは登録が有効である意味であり、実装開始・完了ではない。
