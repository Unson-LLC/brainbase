---
story_id: story-company-os-evaluation-v1
title: 判断開始時の目的で成果と判断の妥当性を別々に評価できる
status: done
created_at: 2026-09-23
implementation_started: true
owner_repository: brainbase
depends_on: ["story-company-os-problem-snapshot-v1"]
external_dependencies: [{"story_id": "story-outcome-case-v1", "source_repo": "brainbase-unson", "relationship": "read-only OutcomeCasePort adapter", "availability": "candidate_provider_verified_at_40d3d8f57d463e2f22a98423d74af3b7ed1aba93"}]
---

# 判断開始時の目的で成果と判断の妥当性を別々に評価できる

## 利用者成果

目的の責任者として、出荷や処理成功と、期待した価値が生まれたことを分けて判断したい。

## 所有と対象

- 登録・実装repo: `Unson-LLC/brainbase`
- 対象: OutcomeCase／評価記録の差分

共通契約・正本保存・単独所有者で動く共通UIを所有する。組織のメンバー・役割・承認規則は組織版providerで実装し、本Storyではその結果を受け取るportと単独所有者の検証を扱う。外部サービスや社内runtimeを必須にしない。

## 既存実装との差分

実装開始時に既存APIの提供版と責務を確認する。既存Storyの登録や本文状態だけで提供済みと扱わない。

- `brainbase-unson / story-outcome-case-v1`：read-only OutcomeCasePort adapter（候補実装 commit `40d3d8f57d463e2f22a98423d74af3b7ed1aba93`）。OSSの `origin/develop` commit `770655c4cdb56195fa1e441455372830840f03c1` にはOutcomeCase APIがなく、既存orgの閉鎖・API・Postgres・RACIはOSSへコピーしない。

## 設計参照

- [全体設計](https://github.com/Unson-LLC/brainbase-project/blob/main/docs/architecture/company-os-design.md)
- [継続運用契約](https://github.com/Unson-LLC/brainbase-project/blob/main/docs/architecture/company-os-operating-contract.md)
- [repo横断依存・実装順](https://github.com/Unson-LLC/brainbase-project/blob/main/docs/architecture/company-os-implementation-map.md)

今回の設計改訂はローカル成果物。これらのURLは所有先を示し、公開・merge済みを意味しない。全体方針をStoryへ複製しない。

## 依存するストーリー

- `brainbase / story-company-os-problem-snapshot-v1`

依存は提供契約の先行条件。目的への貢献・期限とは異なる。外部依存を含め、着手時に採用版と提供範囲を最小Specで固定する。

## 受入条件

- [x] AC-01: 評価はProblemが固定したObjective・基準・測定定義版・評価期間を使い、当時の基準で読戻せる。
- [x] AC-02: 定義版が異なる測定は明示変換なしに比較せず、証拠欠損・未到来期間は判定不能にする。
- [x] AC-03: 予測と実績、結果の達成度、判断時点の妥当性を別々に記録し、外れだけで原因を断定しない。
- [x] AC-04: ホテル例で直接対応が減っても引継ぎ・修正増加や品質悪化があれば自動的に成功としない。既存OutcomeCaseの閉鎖を置換しない。

## 対象外

学習候補の採用、OutcomeCase閉鎖を判断品質と同一視すること。

## 検証と完了

受入条件と反例を最小Specで固定する。変更した保存内容は同じID・版で読戻す。純粋な契約はfixture、永続化は実際のstore、UIは実操作で確認する。共通機能はOSS単独、組織境界は組織adapter、外部作用はManaで検証する。

## 実装状況

- `src/company-os-evaluation.ts` に、Problem snapshotのhistorical read、exact Foundation定義loader、read-only OutcomeCasePort、immutable evaluation sidecar store（`evaluate`／`read`／`list`）を実装した。
- `tests/company-os-evaluation.test.ts` は実際のcanonical Graph/Foundation storeとsidecarを使い、ホテルの負荷・品質反例、欠損・未到来・未来期間、明示conversion provenance、現在ACL失効、scope越境、sidecar破損・派生値改ざん、重複IDを検証する。
- `docs/specs/company-os-evaluation-v1.md` に、所有境界、保存場所、公開port、評価手順、不変条件、エラー境界を固定した。
- `npm run build` と `npx vitest run tests/company-os-evaluation.test.ts --reporter verbose` を実行済み。

AC-01〜04は実装・review・CIで確認済み。[PR #533](https://github.com/Unson-LLC/brainbase/pull/533) はmerge [`7e6359681af6606e14cba8ca8116ca559504e900`](https://github.com/Unson-LLC/brainbase/commit/7e6359681af6606e14cba8ca8116ca559504e900)、最終headは [`50dfc0c16e5872c262c0141b666ec61fc271f876`](https://github.com/Unson-LLC/brainbase/commit/50dfc0c16e5872c262c0141b666ec61fc271f876)、[CI 35850113260](https://github.com/Unson-LLC/brainbase/actions/runs/35850113260) success、delta reviewはblockingなしである。OutcomeCasePortはread-only境界として扱い、既存orgの閉鎖・API・Postgres・RACIのOSS組込みと本番検証は完了条件に含めない。VibeProの `active` は登録状態を示し、完了状態とは別である。
